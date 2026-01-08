export function formatDuration(start?: string, end?: string): string {
  if (!start) {
    return '';
  }
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const ms = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  const remSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${remMinutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remSeconds}s`;
  }
  return `${seconds}s`;
}

export function formatAgo(date?: string): string {
  if (!date) {
    return '';
  }
  const target = new Date(date);
  const delta = Date.now() - target.getTime();
  if (!Number.isFinite(delta)) {
    return '';
  }
  const seconds = Math.floor(delta / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `${seconds}s ago`;
}

export function formatDateTime(date?: string): string {
  if (!date) {
    return '';
  }
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    return '';
  }
  return value.toLocaleString();
}
