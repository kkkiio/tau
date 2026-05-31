export const wsUrl = (port?: number) => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.hostname}${port ? `:${port}` : location.port ? `:${location.port}` : ""}/ws`;
};
