// Build a Markdown snapshot of the current PLAN state and trigger a download.
export function buildPlanMarkdown(opts: {
  tasks: any[];
  reminders: any[];
  meetings: any[];
  notes: any[];
}): string {
  const { tasks, reminders, meetings, notes } = opts;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Vanto PLAN — Snapshot ${today}`, '');
  lines.push(`_Generated ${new Date().toLocaleString()}_`, '');

  const open = tasks.filter((t) => t.status !== 'done');
  const done = tasks.filter((t) => t.status === 'done');
  lines.push(`## Tasks (${open.length} open · ${done.length} done)`, '');
  if (open.length === 0) lines.push('_No open tasks._', '');
  for (const t of open) {
    const due = t.due_date ? ` — due ${t.due_date.slice(0, 10)}` : '';
    lines.push(`- [ ] **${t.priority}** ${t.title}${due}`);
  }
  if (done.length) {
    lines.push('', '### Completed');
    for (const t of done.slice(0, 20)) lines.push(`- [x] ${t.title}`);
  }

  lines.push('', `## Reminders (${reminders.filter((r) => !r.is_done).length} active)`, '');
  for (const r of reminders.filter((r) => !r.is_done)) {
    lines.push(`- ${r.title} — ${new Date(r.reminder_time).toLocaleString()}`);
  }

  lines.push('', `## Meetings (${meetings.length})`, '');
  for (const m of meetings) {
    lines.push(`- ${m.title} — ${new Date(m.start_time).toLocaleString()}${m.location ? ' · ' + m.location : ''}`);
  }

  lines.push('', `## Recent Notes`, '');
  for (const n of notes.slice(0, 7)) {
    lines.push(`### ${n.note_date}`, '', n.content || '_empty_', '');
  }
  return lines.join('\n');
}

export function downloadPlanMarkdown(md: string) {
  const today = new Date().toISOString().slice(0, 10);
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vanto-plan-${today}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
