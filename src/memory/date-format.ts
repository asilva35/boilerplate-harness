// Small local-time formatters, equivalent to Go's time.Format layouts
// used throughout internal/memory/sessionfiles.go ("2006-01-02 15:04",
// "2006-01-02-15h04", "2006-01-02"). No dependency pulled in for this -
// three date fields, padded, is all any of these need.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatFilenameStamp(d: Date): string {
  return `${formatDate(d)}-${pad(d.getHours())}h${pad(d.getMinutes())}`;
}
