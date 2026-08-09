import {
  getGmcpVariables as bridgeGetGmcpVariables,
  isAutomationCompatActive,
  listGmcpVariables as bridgeListGmcpVariables,
  resetGmcpVariables as bridgeResetGmcpVariables,
  setGmcpVariable,
} from './session-compat/automation.js';

const GMCP_VARIABLE_PREFIX = 'gmcp';
const runtimeVariables = {};

function toVariableSegment(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function variableNameFor(parts) {
  return [GMCP_VARIABLE_PREFIX, ...parts]
    .map(toVariableSegment)
    .filter(Boolean)
    .join('_');
}

function serializeValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function setVariable(parts, value) {
  const name = variableNameFor(parts);
  if (!name || name === GMCP_VARIABLE_PREFIX) return;
  runtimeVariables[name] = serializeValue(value);
}

function flattenValue(parts, value) {
  if (value === undefined) return;

  if (value === null || typeof value !== 'object') {
    setVariable(parts, value);
    return;
  }

  setVariable(parts, value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenValue([...parts, String(index)], item);
    });
    return;
  }

  Object.entries(value).forEach(([key, item]) => {
    flattenValue([...parts, key], item);
  });
}

function dispatchGmcpVariablesChanged(detail) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('darkwind:gmcp-variables-changed', {
      detail,
    }));
  }
}

export function registerGmcpVariables(packageName, data) {
  if (isAutomationCompatActive()) {
    setGmcpVariable(packageName, data);
  } else {
    const packageParts = String(packageName || '')
      .split('.')
      .map(toVariableSegment)
      .filter(Boolean);

    if (!packageParts.length) return;
    flattenValue(packageParts, data === undefined ? '' : data);
  }

  dispatchGmcpVariablesChanged({ packageName });
}

export function resetGmcpVariables() {
  if (isAutomationCompatActive()) {
    bridgeResetGmcpVariables();
  } else {
    Object.keys(runtimeVariables).forEach((key) => {
      delete runtimeVariables[key];
    });
  }

  dispatchGmcpVariablesChanged({ reset: true });
}

export function getGmcpVariables() {
  if (isAutomationCompatActive()) {
    return bridgeGetGmcpVariables();
  }
  return { ...runtimeVariables };
}

export function listGmcpVariables() {
  if (isAutomationCompatActive()) {
    return bridgeListGmcpVariables();
  }
  return Object.entries(runtimeVariables)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, value]) => ({ name, value }));
}
