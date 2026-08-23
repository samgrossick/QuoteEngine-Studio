let sequence = 0;

export function editorId(prefix = "editor") {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
