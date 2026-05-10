import { FG_NAMES, BRIGHT_FG_NAMES, DEFAULT_FG, DEFAULT_BG, COLOR_256 } from './constants.js';

function createAnsiState() {
  return {
    buffer: '',
    bold: false,
    underline: false,
    inverse: false,
    blink: false,
    fg: null,
    bg: null,
    href: null,

    reset() {
      this.bold = false;
      this.underline = false;
      this.inverse = false;
      this.blink = false;
      this.fg = null;
      this.bg = null;
    },

    snapshot() {
      return { bold: this.bold, underline: this.underline, inverse: this.inverse,
               blink: this.blink, fg: this.fg, bg: this.bg };
    }
  };
}

const ansi = createAnsiState();

export function parseAnsi(text, parserState = ansi) {
  text = parserState.buffer + text;
  parserState.buffer = '';

  const fragments = [];
  let plain = '';
  let i = 0;
  const flushPlain = () => {
    if (!plain) return;
    const fragment = { text: plain, style: parserState.snapshot() };
    if (parserState.href) fragment.href = parserState.href;
    fragments.push(fragment);
    plain = '';
  };

  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      if (i + 1 >= text.length) {
        parserState.buffer = text.slice(i);
        break;
      }
      if (text[i + 1] === '[') {
        let j = i + 2;
        while (j < text.length && ((text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f))) {
          j++;
        }
        if (j >= text.length) {
          parserState.buffer = text.slice(i);
          break;
        }
        const finalByte = text.charCodeAt(j);
        if (finalByte < 0x40 || finalByte > 0x7e) {
          i++;
          continue;
        }

        flushPlain();

        if (text[j] === 'm') {
          const paramStr = text.slice(i + 2, j);
          const params = paramStr === '' ? [0] : paramStr.split(';').map(Number);
          let p = 0;
          while (p < params.length) {
            const code = params[p];
            if (code === 0) { parserState.reset(); }
            else if (code === 1) { parserState.bold = true; }
            else if (code === 4) { parserState.underline = true; }
            else if (code === 5) { parserState.blink = true; }
            else if (code === 7) { parserState.inverse = true; }
            else if (code === 22) { parserState.bold = false; }
            else if (code === 24) { parserState.underline = false; }
            else if (code === 25) { parserState.blink = false; }
            else if (code === 27) { parserState.inverse = false; }
            else if (code >= 30 && code <= 37) { parserState.fg = { type: 'standard', index: code - 30 }; }
            else if (code === 38 && params[p+1] === 5 && p + 2 < params.length) {
              parserState.fg = { type: '256', index: params[p+2] };
              p += 2;
            }
            else if (code === 38 && params[p+1] === 2 && p + 4 < params.length && isRgb(params[p+2], params[p+3], params[p+4])) {
              parserState.fg = { type: 'rgb', r: params[p+2], g: params[p+3], b: params[p+4] };
              p += 4;
            }
            else if (code === 39) { parserState.fg = null; }
            else if (code >= 40 && code <= 47) { parserState.bg = { type: 'standard', index: code - 40 }; }
            else if (code === 48 && params[p+1] === 5 && p + 2 < params.length) {
              parserState.bg = { type: '256', index: params[p+2] };
              p += 2;
            }
            else if (code === 48 && params[p+1] === 2 && p + 4 < params.length && isRgb(params[p+2], params[p+3], params[p+4])) {
              parserState.bg = { type: 'rgb', r: params[p+2], g: params[p+3], b: params[p+4] };
              p += 4;
            }
            else if (code === 49) { parserState.bg = null; }
            else if (code >= 90 && code <= 97) { parserState.fg = { type: 'bright', index: code - 90 }; }
            else if (code >= 100 && code <= 107) { parserState.bg = { type: 'bright', index: code - 100 }; }
            p++;
          }
        }

        i = j + 1;
      } else if (text[i + 1] === ']') {
        let j = i + 2;
        let terminatorLength = 0;
        while (j < text.length) {
          if (text.charCodeAt(j) === 0x07) {
            terminatorLength = 1;
            break;
          }
          if (text.charCodeAt(j) === 0x1b && text[j + 1] === '\\') {
            terminatorLength = 2;
            break;
          }
          j++;
        }
        if (!terminatorLength) {
          parserState.buffer = text.slice(i);
          break;
        }

        flushPlain();

        const osc = text.slice(i + 2, j);
        if (osc.slice(0, 3) === '8;;') {
          parserState.href = osc.length > 3 ? osc.slice(3) : null;
        }

        i = j + terminatorLength;
      } else {
        i += 2;
      }
    } else {
      plain += text[i];
      i++;
    }
  }

  flushPlain();

  return fragments;
}

export function parseAnsiText(text) {
  return parseAnsi(text || '', createAnsiState());
}

function isRgb(r, g, b) {
  return [r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function resolveColor(color, isBackground) {
  if (!color) return isBackground ? DEFAULT_BG : DEFAULT_FG;
  if (color.type === '256') return COLOR_256[color.index] || (isBackground ? DEFAULT_BG : DEFAULT_FG);
  if (color.type === 'rgb') return rgbToHex(color.r, color.g, color.b);
  if (color.type === 'standard') return COLOR_256[color.index];
  if (color.type === 'bright') return COLOR_256[color.index + 8];
  return isBackground ? DEFAULT_BG : DEFAULT_FG;
}

export function styleToElement(text, style) {
  if (!text) return null;

  const needsStyling = style.bold || style.underline || style.inverse || style.blink || style.fg || style.bg;
  if (!needsStyling) {
    return document.createTextNode(text);
  }

  const span = document.createElement('span');
  const classes = [];
  let inlineFg = null;
  let inlineBg = null;

  if (style.inverse) {
    inlineFg = resolveColor(style.bg, true);
    inlineBg = resolveColor(style.fg, false);
  } else {
    if (style.fg) {
      if (style.fg.type === '256') {
        inlineFg = COLOR_256[style.fg.index];
      } else if (style.fg.type === 'rgb') {
        inlineFg = rgbToHex(style.fg.r, style.fg.g, style.fg.b);
      } else if (style.fg.type === 'standard') {
        classes.push('ansi-fg-' + FG_NAMES[style.fg.index]);
      } else if (style.fg.type === 'bright') {
        classes.push('ansi-fg-' + BRIGHT_FG_NAMES[style.fg.index]);
      }
    }
    if (style.bg) {
      if (style.bg.type === '256') {
        inlineBg = COLOR_256[style.bg.index];
      } else if (style.bg.type === 'rgb') {
        inlineBg = rgbToHex(style.bg.r, style.bg.g, style.bg.b);
      } else if (style.bg.type === 'standard') {
        classes.push('ansi-bg-' + FG_NAMES[style.bg.index]);
      } else if (style.bg.type === 'bright') {
        classes.push('ansi-bg-' + BRIGHT_FG_NAMES[style.bg.index]);
      }
    }
  }

  if (style.bold) classes.push('ansi-bold');
  if (style.underline) classes.push('ansi-underline');
  if (style.blink) classes.push('ansi-blink');

  if (classes.length) span.className = classes.join(' ');
  let inlineStyle = '';
  if (inlineFg) inlineStyle += 'color:' + inlineFg + ';';
  if (inlineBg) inlineStyle += 'background-color:' + inlineBg + ';';
  if (inlineStyle) span.setAttribute('style', inlineStyle);

  span.appendChild(document.createTextNode(text));
  return span;
}
