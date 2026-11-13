// Preserve unchanged controls across periodic refreshes, including their focus,
// checkbox state and disabled buttons. Include handler inputs in display data.
export function createStableRowRenderer(container, createRow) {
  let current = new Map();
  return rows => {
    const next = new Map(), ordered = [];
    for (const row of rows) {
      const key = row.releaseId;
      if (typeof key !== 'string' || next.has(key)) throw Error('row-identity-invalid');
      const signature = JSON.stringify(row), prior = current.get(key);
      const entry = prior?.signature === signature ? prior : { signature, node: createRow(row) };
      next.set(key, entry); ordered.push(entry.node);
    }
    // Prepare before changing the live list; a no-op refresh never touches DOM.
    const retained = new Set(ordered);
    for (const child of [...container.children]) if (!retained.has(child)) child.remove();
    for (let index = 0; index < ordered.length; index += 1) {
      const node = ordered[index], at = container.children[index];
      if (node !== at) container.insertBefore(node, at ?? null);
    }
    current = next;
  };
}
