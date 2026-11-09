export interface LocalAlignment {
  // Expected-text boundaries projected onto the selected text (UTF-16 offsets).
  boundaries: number[];
  changed: { start: number; end: number }[];
}
// Used only between already established prose anchors. This projects boundaries;
// it never authorizes a formula image. Each projected formula is checked exactly.
export function alignLocal(alternatives: string[][], actual: string): LocalAlignment | undefined {
  const n = alternatives.length,
    m = actual.length;
  if (!n || !m || n > 2048 || m > 2048 || (n + 1) * (m + 1) > 1_000_000) return;
  const stride = m + 1,
    cost = new Uint16Array((n + 1) * stride);
  for (let i = 1; i <= n; i++)
    cost[i * stride] = cost[(i - 1) * stride] + (alternatives[i - 1].includes('') ? 0 : 1);
  for (let j = 0; j <= m; j++) cost[j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      cost[i * stride + j] = Math.min(
        cost[(i - 1) * stride + j - 1] + (alternatives[i - 1].includes(actual[j - 1]) ? 0 : 1),
        cost[(i - 1) * stride + j] + (alternatives[i - 1].includes('') ? 0 : 1),
        cost[i * stride + j - 1] + 1,
      );
  if (cost[n * stride + m] > Math.min(64, Math.max(4, Math.max(n, m) * 0.3))) return;
  const steps: { expected: boolean; actual: boolean; changed: boolean }[] = [];
  let i = n,
    j = m;
  while (i || j) {
    const different = i > 0 && j > 0 && !alternatives[i - 1].includes(actual[j - 1]);
    if (i && j && cost[i * stride + j] === cost[(i - 1) * stride + j - 1] + Number(different)) {
      steps.push({ expected: true, actual: true, changed: different });
      i--;
      j--;
    } else if (
      i &&
      cost[i * stride + j] ===
        cost[(i - 1) * stride + j] + (alternatives[i - 1].includes('') ? 0 : 1)
    ) {
      steps.push({ expected: true, actual: false, changed: !alternatives[i - 1].includes('') });
      i--;
    } else {
      steps.push({ expected: false, actual: true, changed: true });
      j--;
    }
  }
  const boundaries = [0],
    changed: LocalAlignment['changed'] = [];
  i = j = 0;
  for (const step of steps.reverse()) {
    if (step.changed && step.actual) {
      const last = changed.at(-1);
      if (last?.end === j) last.end++;
      else changed.push({ start: j, end: j + 1 });
    }
    if (step.expected) i++;
    if (step.actual) j++;
    boundaries[i] = j;
  }
  return { boundaries, changed };
}
