#!/usr/bin/env python3
"""Edit pack conformance vectors (E70, extension 0.64.0). Synthetic media only.

Writes one folder per case with the pack and expected.json: the archive_id the import
must produce, or the refusal code. Run: python3 make_vectors.py  (from this folder).
The archive_id here comes from this file's own normalisation (Python), independent of
the extension's src/ss-normalize.mjs; the extension's tests must agree byte for byte,
and the website pins the same vectors.

Normalisation rules (docs/technical/SS_ARCHIVE_V1.md, "Edit pack import profile"). 0.64.1 (R1, R2): a poster.jpg is
ignored; publication settings are explicit (see edit-pack-fields.mjs). 0.64.1 (R3): content is always {spoilers:false, warnings:[]}:
0.65.4: an absent episode tier is "unverified" (never a guessed "ad-free"). 0.65.5 (E78): an absent territory is "ZZ" (unknown), never a guessed "US":
- each clip: SHA-256 of its bytes; duration = round-half-up(mvhd.duration * 1000 / mvhd.timescale) ms;
  width/height = the video track's tkhd width/height (16.16 fixed point, integer part);
- packet: schema 1.0.0 local-user packet, ids from edit.json id/revision, verified_at fixed at
  2026-01-01T00:00:00.000Z, min adapter 0.1.0, segments sorted by (start, end, file order) and
  numbered scene-1..n, bindings clips/<sha>.mp4 in segment order;
- archive_id = sha256("seamless-scene-edit/1\\n" + hex(sha256(canonical(packet))) + "\\n" + sorted hashes joined by "\\n").
"""
import hashlib, io, json, os, re, shutil, struct, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '_source')
CLIP_A, CLIP_B, POSTER = (open(os.path.join(SRC, n), 'rb').read() for n in ('clip-a.mp4', 'clip-b.mp4', 'poster.jpg'))
FIXED = (2026, 1, 1, 0, 0, 0)

EPISODE = {'service': 'prime-video', 'gti': 'amzn1.dv.gti.00000000-0000-4000-8000-0000000e7070', 'show': 'Synthetic Show',
           'season': 1, 'episode': 2, 'episode_title': 'Test Pattern', 'runtime_ms': 1_800_000}
# R2/R3 (0.64.1): every publication setting explicit (title, description, category, tags, mature,
# release_notes, imdb_url, revision); none is ever defaulted.
EDIT = {'format': 'seamless-edit-pack', 'version': 1, 'id': 'synthetic-pack', 'revision': 1, 'title': 'Synthetic pack',
        'description': 'Two synthetic test-pattern scenes for the edit pack vectors.', 'creator_name': 'vectors',
        'tags': ['synthetic'], 'category': 'other', 'mature': False, 'release_notes': '', 'imdb_url': '',
        'episode': EPISODE,
        'scenes': [
            {'action': 'INSERT', 'at': '20:00.000', 'clip': 'clips/clip-b.mp4', 'gain_db': -2},
            {'action': 'REPLACE', 'start': '10:00.000', 'end': '10:05.500', 'clip': 'clips/clip-a.mp4', 'note': 'first'},
        ]}


def canonical(v):
    if isinstance(v, list):
        return '[' + ','.join(canonical(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical(v[k]) for k in sorted(v)) + '}'
    return json.dumps(v, ensure_ascii=False)


def boxes(b, start, end):
    p = start
    while p + 8 <= end:
        size, kind = struct.unpack('>I4s', b[p:p + 8]); header = 8
        if size == 1:
            size = struct.unpack('>Q', b[p + 8:p + 16])[0]; header = 16
        if size == 0:
            size = end - p
        yield kind.decode('latin-1'), p + header, p + size
        p += size


def child(b, start, end, kind):
    return next((s, e) for k, s, e in boxes(b, start, end) if k == kind)


def measure(b):
    moov = child(b, 0, len(b), 'moov')
    s, e = child(b, *moov, 'mvhd')
    version = b[s]
    if version == 1:
        timescale, duration = struct.unpack('>IQ', b[s + 20:s + 32])
    else:
        timescale, duration = struct.unpack('>II', b[s + 12:s + 20])
    ms = (duration * 1000 + timescale // 2) // timescale
    for k, ts, te in boxes(b, *moov):
        if k != 'trak':
            continue
        mdia = child(b, ts, te, 'mdia'); hs, he = child(b, *mdia, 'hdlr')
        if b[hs + 8:hs + 12] != b'vide':
            continue
        ks, ke = child(b, ts, te, 'tkhd')
        w, h = struct.unpack('>II', b[ke - 8:ke])
        return ms, w >> 16, h >> 16
    raise SystemExit('no video track')


def ms_of(value):
    if isinstance(value, int):
        return value
    m = re.fullmatch(r'(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?', value)
    h, mi, se, frac = m.groups()
    return ((int(h or 0) * 60 + int(mi)) * 60 + int(se)) * 1000 + int((frac or '0').ljust(3, '0'))


def revision_of(edit):
    r = edit.get('revision')
    return r if isinstance(r, int) and not isinstance(r, bool) and r >= 1 else 1


def content_of(edit):
    # R3: fixed manifest-format constants; edit.json spoilers/synthetic_media/real_person_likeness/warnings are ignored.
    return {'spoilers': False, 'warnings': []}


def packet_from_edit(edit, clips):
    ep = edit['episode']
    scenes = []
    for i, s in enumerate(edit['scenes']):
        if s['action'] == 'INSERT':
            start = end = ms_of(s['at'])
        else:
            start, end = ms_of(s['start']), ms_of(s['end'])
        scenes.append((start, end, i, s))
    scenes.sort(key=lambda x: (x[0], x[1], x[2]))
    segments, bindings = [], []
    for n, (start, end, _, s) in enumerate(scenes, 1):
        data = clips[s['clip']]
        sha = hashlib.sha256(data).hexdigest(); dur, w, h = measure(data)
        transition = {'type': 'hard_cut'}
        if 'gain_db' in s:
            transition['gain_db'] = s['gain_db']
        segments.append({'segment_id': f'scene-{n}', 'action': s['action'], 'trigger_time_ms': start, 'resume_time_ms': end,
                         'asset': {'sha256': sha, 'expected_duration_ms': dur, 'container': 'video/mp4', 'video_codec': 'avc1',
                                   'audio_codec': 'mp4a', 'width': w, 'height': h, 'dynamic_range': 'sdr'},
                         'transition': transition, 'failure_policy': 'continue_native'})
        if sha not in [b['sha256'] for b in bindings]:
            bindings.append({'sha256': sha, 'relative_path': f'clips/{sha}.mp4'})
    return {'packet_schema_version': '1.0.0', 'packet_id': edit['id'], 'purpose': 'local-user-edit',
            'manifest': {'schema_version': '1.0.0', 'edit_id': edit['id'], 'manifest_version': revision_of(edit), 'status': 'local-only',
                         'source': {'service': ep.get('service', 'prime-video'), 'territory': ep.get('territory', 'ZZ'),
                                    'service_content_id': ep['gti'], 'title': ep['show'], 'season': ep['season'], 'episode': ep['episode'],
                                    'expected_runtime_ms': ep['runtime_ms'], 'runtime_tolerance_ms': ep.get('runtime_tolerance_ms', 3000),
                                    'service_tier': ep.get('tier', 'unverified'), 'version_tag': ep.get('version_tag', 'creator-reported')},
                         'compatibility': {'min_adapter_version': '0.1.0', 'max_adapter_version': '0.x', 'verified_at': '2026-01-01T00:00:00.000Z'},
                         'segments': segments,
                         'feature_flags': {'replace_enabled': True, 'insert_enabled': True, 'skip_enabled': False, 'mute_enabled': False, 'emergency_disable': False},
                         'content': content_of(edit),
                         'signature': None},
            'asset_bindings': bindings}


def archive_id(packet):
    hashes = sorted({b['sha256'] for b in packet['asset_bindings']})
    inner = hashlib.sha256(canonical(packet).encode()).hexdigest()
    return hashlib.sha256(f'seamless-scene-edit/1\n{inner}\n'.encode() + '\n'.join(hashes).encode()).hexdigest()


class NoSeek(io.RawIOBase):
    """A write-only stream without seek, so zipfile writes data descriptors (flag bit 3)."""
    def __init__(self):
        self.buf = bytearray()
    def writable(self):
        return True
    def write(self, b):
        self.buf += b
        return len(b)


def make_zip(entries, method=zipfile.ZIP_DEFLATED, descriptors=False, zip64_local=False):
    target = NoSeek() if descriptors else io.BytesIO()
    with zipfile.ZipFile(target, 'w') as z:
        for name, data in entries:
            info = zipfile.ZipInfo(name, date_time=FIXED)
            info.compress_type = zipfile.ZIP_STORED if name.endswith('/') else method
            info.external_attr = (0o40755 << 16 | 0x10) if name.endswith('/') else (0o100644 << 16)
            with z.open(info, 'w', force_zip64=zip64_local and not name.endswith('/')) as f:
                f.write(data)
    return bytes(target.buf if descriptors else target.getvalue())


def add_zip64_end(data):
    """Inserts a ZIP64 end-of-central-directory record and locator before the end record."""
    end = data.rfind(b'PK\x05\x06')
    count, = struct.unpack('<H', data[end + 10:end + 12]); size, offset = struct.unpack('<II', data[end + 12:end + 20])
    rec = struct.pack('<IQHHIIQQQQ', 0x06064b50, 44, 45, 45, 0, 0, count, count, size, offset)
    loc = struct.pack('<IIQI', 0x07064b50, 0, end, 1)
    return data[:end] + rec + loc + data[end:]


def set_method(data, method):
    """Rewrites every entry's compression method (local and central headers) to `method`."""
    b = bytearray(data); p = 0
    while True:
        p = b.find(b'PK\x03\x04', p)
        if p < 0:
            break
        struct.pack_into('<H', b, p + 8, method); p += 4
    p = 0
    while True:
        p = b.find(b'PK\x01\x02', p)
        if p < 0:
            break
        struct.pack_into('<H', b, p + 10, method); p += 4
    return bytes(b)


def write(case, filename, data, expected):
    folder = os.path.join(HERE, case)
    shutil.rmtree(folder, ignore_errors=True); os.makedirs(folder)
    with open(os.path.join(folder, filename), 'wb') as f:
        f.write(data)
    expected = {'file': filename, **expected}
    with open(os.path.join(folder, 'expected.json'), 'w') as f:
        json.dump(expected, f, indent=1, ensure_ascii=False); f.write('\n')
    print(case, filename, len(data), expected.get('archive_id', expected.get('refusal')))


def main():
    clips = {'clips/clip-a.mp4': CLIP_A, 'clips/clip-b.mp4': CLIP_B}
    pid = archive_id(packet_from_edit(EDIT, clips))
    edit_bytes = json.dumps(EDIT, indent=1, ensure_ascii=False).encode()
    base = [('edit.json', edit_bytes), ('clips/clip-a.mp4', CLIP_A), ('clips/clip-b.mp4', CLIP_B), ('poster.jpg', POSTER)]
    same = {'archive_id': pid, 'title': EDIT['title'], 'clips': 2}
    write('01-deflate', 'edit-pack.zip', make_zip(base), same)
    write('02-stored', 'edit-pack.zip', make_zip(base, method=zipfile.ZIP_STORED), same)
    write('03-wrapper-folder', 'My Edit.zip', make_zip([('My Edit/', b''), ('My Edit/clips/', b'')] + [(f'My Edit/{n}', d) for n, d in base]), same)
    junk = [('__MACOSX/', b''), ('__MACOSX/._edit.json', b'\x00\x05\x16\x07junk'), ('._edit.json', b'\x00\x05\x16\x07junk'),
            ('.DS_Store', b'\x00\x00\x00\x01Bud1'), ('clips/.DS_Store', b'Bud1'), ('clips/._clip-a.mp4', b'\x00\x05\x16\x07'), ('Thumbs.db', b'\xd0\xcf')]
    write('04-macos-junk', 'Archive.zip', make_zip([('clips/', b'')] + base + junk), same)
    write('05-data-descriptors', 'edit-pack.zip', make_zip(base, descriptors=True), same)
    write('06-zip64-extras', 'edit-pack.zip', add_zip64_end(make_zip(base, zip64_local=True)), same)
    # R3: old packs carrying the removed keys still import, with the same id (the keys are ignored).
    friendly = dict(EDIT, spoilers=True, synthetic_media=True, real_person_likeness=True, warnings=['old warning'], scenes=[dict(EDIT['scenes'][0], clip='clips/Cold open B.mp4', at=1_200_000),
                                  dict(EDIT['scenes'][1], clip='clips/Scene 1 (take 2).mp4', start='0:10:00', end=605_500)])
    write('07-friendly-names', 'Synthetic pack.ss', make_zip([('edit.json', json.dumps(friendly).encode()), ('clips/Scene 1 (take 2).mp4', CLIP_A),
                                                               ('clips/Cold open B.mp4', CLIP_B)]), same)
    # A full edit-packet.json with friendly relative_paths (today's builder export layout, renamed).
    # Written by an older builder, with its tier and country stated (0.65.4 and 0.65.5 changed only the defaults for absent ones).
    full = packet_from_edit(dict(EDIT, id='synthetic-full-packet', revision=3, episode=dict(EPISODE, tier='ad-free', territory='US')), clips)
    # A full packet is kept as written (R3): its content carries the keys an older builder wrote.
    full['manifest']['content'] = {'spoilers': False, 'warnings': [], 'synthetic_media': True, 'real_person_likeness': False}
    names = {CLIP_A: 'clips/Scene A.mp4', CLIP_B: 'clips/Scene B.mp4'}
    for b in full['asset_bindings']:
        b['relative_path'] = names[CLIP_A] if hashlib.sha256(CLIP_A).hexdigest() == b['sha256'] else names[CLIP_B]
    rewritten = json.loads(json.dumps(full))
    for b in rewritten['asset_bindings']:
        b['relative_path'] = f"clips/{b['sha256']}.mp4"
    details = {'title': 'Synthetic full packet', 'description': 'A full edit-packet.json with friendly clip names.', 'creator_name': 'vectors'}
    write('08-full-packet-friendly-paths', 'full-packet.zip', make_zip([('edit-packet.json', json.dumps(full, indent=1).encode()), ('details.json', json.dumps(details).encode()),
                                                                        ('poster.jpg', POSTER), ('clips/Scene A.mp4', CLIP_A), ('clips/Scene B.mp4', CLIP_B)]),
          {'archive_id': archive_id(rewritten), 'title': details['title'], 'clips': 2})
    write('09-missing-clip', 'missing-clip.zip', make_zip([('edit.json', edit_bytes), ('clips/clip-a.mp4', CLIP_A)]),
          {'refusal': 'pack-clip-missing', 'message_contains': 'clips/clip-b.mp4'})
    write('10-deflate64', 'explorer-large.zip', set_method(make_zip(base, method=zipfile.ZIP_STORED), 9),
          {'refusal': 'pack-deflate64', 'message_contains': 'Re-zip with 7-Zip'})
    # R2: a pack with no publication settings still plays; every setting is reported missing.
    bare = {'id': 'synthetic-bare', 'episode': EPISODE, 'scenes': EDIT['scenes']}
    write('11-listing-missing', 'bare.zip', make_zip([('edit.json', json.dumps(bare).encode()), ('clips/clip-a.mp4', CLIP_A), ('clips/clip-b.mp4', CLIP_B)]),
          {'archive_id': archive_id(packet_from_edit(bare, clips)), 'title': None, 'clips': 2,
           'missing': ['title', 'description', 'category', 'tags', 'mature', 'revision']})


if __name__ == '__main__':
    main()
