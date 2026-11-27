export function assertNewRelease({ pluginVersion, desktopVersion, previousPluginVersion, previousDesktopVersion, desktop }) {
  if (compare(pluginVersion, previousPluginVersion) <= 0) {
    throw new Error(`Plugin ${pluginVersion} must be newer than published ${previousPluginVersion}`);
  }
  const delta = compare(desktopVersion, previousDesktopVersion);
  if (desktop ? delta <= 0 : delta !== 0) {
    throw new Error(desktop
      ? `Desktop ${desktopVersion} must be newer than published ${previousDesktopVersion}`
      : "Plugin-only release must keep the published desktop version");
  }
}

function compare(left, right) {
  const parse = (value) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`Expected stable x.y.z version: ${value}`);
    return value.split(".").map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
