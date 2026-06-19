// GMCP package names
export const DW_WINDOW_OPEN = 'Darkwind.Window.Open';
export const DW_WINDOW_UPDATE = 'Darkwind.Window.Update';
export const DW_WINDOW_CLOSE = 'Darkwind.Window.Close';
export const DW_WINDOW_SUBMIT = 'Darkwind.Window.Submit';
export const DW_WINDOW_ACTION = 'Darkwind.Window.Action';
export const DW_WINDOW_CLOSED = 'Darkwind.Window.Closed';

// Element type sets for identification
export const LAYOUT_TYPES = new Set(['vertical', 'horizontal', 'grid']);
export const INPUT_TYPES = new Set(['text', 'password', 'number', 'select', 'checkbox', 'button', 'hidden']);
export const DISPLAY_TYPES = new Set([
  'heading',
  'paragraph',
  'text',
  'ansi_text',
  'divider',
  'progress',
  'image',
  'youtube_embed',
  'player_row',
  'finger_profile',
]);

// Button actions
export const ACTION_SUBMIT = 'submit';
export const ACTION_CLOSE = 'close';
export const ACTION_ACTION = 'action';

// Allowlisted CSS properties for server-provided styles
export const STYLE_ALLOWLIST = new Set([
  'color', 'background', 'backgroundColor', 'fontSize', 'fontWeight', 'fontStyle',
  'textAlign', 'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'gap', 'justifyContent', 'alignItems', 'flexDirection',
  'width', 'maxWidth', 'minWidth', 'height', 'maxHeight', 'minHeight',
  'border', 'borderRadius', 'opacity', 'gridTemplateColumns', 'overflow',
  'lineHeight', 'textTransform',
]);
