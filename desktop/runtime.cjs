'use strict';

function isSteamDistribution({ argv = process.argv, env = process.env, distribution = '' } = {}) {
  if (String(distribution).toLowerCase() === 'steam') return true;
  if (String(env.DARKFLOW_DISTRIBUTION || '').toLowerCase() === 'steam') return true;
  if (env.SteamAppId || env.SteamGameId) return true;

  return argv.some((arg) => {
    const value = String(arg).toLowerCase();
    return value === '--steam' || value === '--distribution=steam';
  });
}

function selectDesktopServeMode({ isPackaged = false, argv = process.argv } = {}) {
  if (isPackaged || argv.includes('--built-client')) return 'built';
  return 'legacy';
}

function isAllowedAppUrl(candidate, appOrigin) {
  try {
    return new URL(candidate).origin === new URL(appOrigin).origin;
  } catch (error) {
    return false;
  }
}

function isSafeExternalUrl(candidate) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(candidate).protocol);
  } catch (error) {
    return false;
  }
}

module.exports = {
  isAllowedAppUrl,
  isSafeExternalUrl,
  isSteamDistribution,
  selectDesktopServeMode,
};
