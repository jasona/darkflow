import { gmcp } from './gmcp.js';
import {
  STREET_SAMURAI_PACKAGE,
  streetSamuraiDashboardView,
} from './street-samurai-dashboard.js';
import { disposeControllerLifecycle, installControllerLifecycle } from './session-compat/controllers.js';

export const streetSamuraiDashboardManager = {
  initialized: false,

  init() {
    return installControllerLifecycle(this, 'street-samurai-dashboard', gmcp, (scopedGmcp) => {
      this.initialized = true;
      scopedGmcp.on(STREET_SAMURAI_PACKAGE, (payload) => {
        streetSamuraiDashboardView.update(payload);
      });
    }, () => { this.initialized = false; });
  },

  dispose() {
    disposeControllerLifecycle(this);
  },

  getSnapshot() {
    return streetSamuraiDashboardView.getSnapshot();
  },
};
