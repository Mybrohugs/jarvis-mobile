// Sharing only fills the form. Playback always requires the owner's button press.
export function sharedVideo(search) {
  const params = new URLSearchParams(search);
  for (const value of [params.get('url'), params.get('text')]) {
    const match = (value || '').match(/https?:\/\/[^\s<>"']+/i);
    if (!match) { continue; }
    const candidate = match[0].replace(/[),.!?;]+$/, '');
    try {
      const url = new URL(candidate);
      if (!url.username && !url.password && candidate.length <= 2000) { return candidate; }
    } catch (e) { /* try the next shared field */ }
  }
  return '';
}
