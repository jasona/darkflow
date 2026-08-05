# Blueprint: Web-Based WebSocket Client for LDMud

## Context

LDMud now has native WebSocket support (RFC 6455) compiled into the driver.
This blueprint describes how to build a web-based game client that connects
to the MUD via WebSocket. Hand this file to Claude in a new session to
implement it.

The driver source lives at `../ldmud/`. The WebSocket implementation is in
`src/pkg-websocket.c` and `src/pkg-websocket.h`.

---

## How the Driver's WebSocket Support Works

### Connection Establishment

The driver uses **auto-detection**: when a new TCP connection's first bytes
are `GET ` (an HTTP request), the driver handles it as a WebSocket upgrade
instead of telnet. No special port or configuration is needed -- WebSocket
and telnet clients connect to the **same port**.

The handshake is standard RFC 6455:

```
Client -> Server:
  GET / HTTP/1.1
  Host: <host>:<port>
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Key: <base64 nonce>
  Sec-WebSocket-Version: 13

Server -> Client:
  HTTP/1.1 101 Switching Protocols
  Upgrade: websocket
  Connection: Upgrade
  Sec-WebSocket-Accept: <computed accept key>
```

The browser's built-in `WebSocket` API handles all of this automatically.
From the client side, it is simply:

```javascript
const ws = new WebSocket("ws://host:port");
// or for TLS:
const ws = new WebSocket("wss://host:port");
```

### Data Flow After Handshake

**Client -> Server (sending commands):**
- Send a text WebSocket frame containing the command string.
- The driver delivers it to the LPC mudlib as a normal command, exactly as
  if the player typed it in a telnet client.
- No special framing, no protocol wrapping -- just the raw command text.
- Example: `ws.send("look");` sends the "look" command.

**Server -> Client (receiving output):**
- All game output (room descriptions, combat messages, chat, prompts) is
  sent as text WebSocket frames.
- The text is UTF-8 encoded.
- The output may contain ANSI escape sequences for color, depending on the
  mudlib configuration.
- Messages arrive as the `message` event on the WebSocket object.

**Binary frames (optional, advanced):**
- The driver supports binary WebSocket frames via the `H_WEBSOCKET` driver
  hook and the `websocket_send(data, WS_BINARY)` efun.
- If the mudlib sends binary frames, they arrive as `Blob` or `ArrayBuffer`
  on the client depending on `ws.binaryType`.
- This is **mudlib-dependent** -- most mudlibs will only use text frames
  initially. The client should handle both gracefully.

### Close Behavior

- When the player disconnects (closes browser tab), the browser sends a
  WebSocket close frame. The driver handles the close handshake and calls
  `disconnect()` in the master object, same as a telnet disconnect.
- When the driver disconnects the player (quit command, timeout, etc.), it
  sends a close frame with code 1001 ("Going Away").
- The client should handle `onclose` and display an appropriate message.

### No Telnet Negotiation

WebSocket connections have telnet disabled. There is:
- No IAC escaping
- No NAWS (window size) negotiation
- No GMCP/MSDP/MSSP over telnet subnegotiations
- No MCCP compression (WebSocket has its own compression via permessage-deflate)

If the mudlib uses GMCP or similar structured data, it would need to be
delivered via binary WebSocket frames or embedded in text output. This is a
mudlib-level concern, not a client concern.

### ANSI Color

The driver/mudlib may send ANSI SGR escape sequences (`\x1b[...m`) in text
output for colors. The web client must either:
1. Parse and render ANSI codes as styled HTML (recommended), or
2. Strip them for plain text display.

Common ANSI codes to handle:
- `\x1b[0m`  -- Reset
- `\x1b[1m`  -- Bold
- `\x1b[30m` through `\x1b[37m` -- Foreground colors (black, red, green, yellow, blue, magenta, cyan, white)
- `\x1b[40m` through `\x1b[47m` -- Background colors
- `\x1b[90m` through `\x1b[97m` -- Bright foreground colors
- 256-color: `\x1b[38;5;<n>m` (foreground), `\x1b[48;5;<n>m` (background)

---

## Client Architecture

### Technology Stack

- **Single HTML file** with embedded CSS and JavaScript (no build tools needed).
- Uses the browser-native `WebSocket` API (no libraries required for connection).
- Vanilla JavaScript -- no frameworks. Keep it simple and self-contained.

### File Structure

Create a single file: `../ldmud/mudlib/www/webclient.html`

This file will be a fully self-contained web application.

### UI Layout

```
+---------------------------------------------------------------+
|  LDMud Web Client                          [Connect] [Status] |
+---------------------------------------------------------------+
|                                                               |
|  +----------------------------------------------------------+|
|  |                                                          ||
|  |  (scrollable output area - game text appears here)       ||
|  |                                                          ||
|  |  > Welcome to LDMud!                                     ||
|  |  > You are in a dark room.                               ||
|  |  > Exits: north, south                                   ||
|  |                                                          ||
|  +----------------------------------------------------------+|
|                                                               |
|  +----------------------------------------------+ [Send]     |
|  | (command input field)                         |            |
|  +----------------------------------------------+            |
+---------------------------------------------------------------+
|  Connected to ws://localhost:4242 | Latency: 23ms             |
+---------------------------------------------------------------+
```

### Core Components

#### 1. Connection Manager

```
- Host/port input fields (default: current page host, port 4242)
- Connect/Disconnect button
- Connection state display (Connecting / Connected / Disconnected)
- Auto-reconnect with exponential backoff (optional, off by default)
- WSS toggle checkbox (uses wss:// instead of ws://)
```

#### 2. Output Display

```
- Scrollable div with monospace font (terminal-like)
- ANSI color code parsing -> styled <span> elements
- Auto-scroll to bottom on new output (unless user has scrolled up)
- Preserve scroll position when user is reading history
- Word-wrap for long lines
- Configurable max line history (e.g., 5000 lines, prune oldest)
- Newline handling: split on \n, each line becomes a <div>
```

#### 3. Command Input

```
- Single-line text input field
- Submit on Enter key
- Command history (up/down arrow keys, stored in array)
- History persists in sessionStorage (survives page refresh)
- Clear input after sending
- Focus management: always return focus to input after sending
- Optional: Ctrl+L to clear output
```

#### 4. ANSI Parser

The ANSI parser converts escape sequences to styled HTML spans:

```
Input:  "\x1b[1;31mDanger!\x1b[0m You see a dragon."
Output: <span class="ansi-bold ansi-fg-red">Danger!</span>
        <span>You see a dragon.</span>
```

Implementation approach:
- State machine that tracks current foreground, background, bold/dim/etc.
- Walk the string character by character looking for ESC (0x1b).
- When ESC[ is found, parse the numeric parameters up to the final letter.
- For 'm' (SGR), apply the styling.
- Emit styled <span> elements with CSS classes.
- Handle incomplete sequences at message boundaries (buffer partial escapes).

CSS classes for ANSI colors:

```css
.ansi-fg-black   { color: #000; }
.ansi-fg-red     { color: #a00; }
.ansi-fg-green   { color: #0a0; }
.ansi-fg-yellow  { color: #a50; }
.ansi-fg-blue    { color: #00a; }
.ansi-fg-magenta { color: #a0a; }
.ansi-fg-cyan    { color: #0aa; }
.ansi-fg-white   { color: #aaa; }

/* Bright variants (bold or 90-97 codes) */
.ansi-fg-bright-black   { color: #555; }
.ansi-fg-bright-red     { color: #f55; }
.ansi-fg-bright-green   { color: #5f5; }
.ansi-fg-bright-yellow  { color: #ff5; }
.ansi-fg-bright-blue    { color: #55f; }
.ansi-fg-bright-magenta { color: #f5f; }
.ansi-fg-bright-cyan    { color: #5ff; }
.ansi-fg-bright-white   { color: #fff; }

/* Same pattern for .ansi-bg-* */

.ansi-bold      { font-weight: bold; }
.ansi-underline { text-decoration: underline; }
.ansi-inverse   { /* swap fg/bg via filter or manual swap */ }
```

#### 5. Status Bar

```
- Connection URL
- Connection duration (time since connected)
- Bytes sent / received counters
- Latency indicator (optional: measure round-trip via application-level ping)
```

### Behavior Specifications

**On Connect:**
1. Construct URL: `ws[s]://<host>:<port>/`
2. Create `new WebSocket(url)`
3. Set `ws.binaryType = "arraybuffer"`
4. Display "Connecting..." in status bar
5. On `open`: display "Connected" in status bar, focus input field
6. On `error`: display error, set state to disconnected
7. On `close`: display close code and reason, set state to disconnected
8. On `message`: pass `event.data` to output handler

**On Receive Message (text frame):**
1. `event.data` is a string (UTF-8 text from the game)
2. Split on `\n` into lines
3. For each line: parse ANSI codes, create styled HTML, append to output
4. If user hasn't scrolled up, auto-scroll to bottom
5. Prune old lines if over max history

**On Receive Message (binary frame):**
1. `event.data` is an ArrayBuffer
2. For now, convert to hex dump or ignore
3. Future: structured protocol handling

**On Send Command:**
1. Read input field value
2. `ws.send(text)` -- sends as text frame
3. Push to command history array
4. Clear input field
5. Display the sent command in the output (echo), prefixed with `> `
6. Scroll to bottom

**On Disconnect:**
1. If user-initiated: `ws.close(1000, "User disconnect")`
2. Display disconnect message in output area
3. Disable input field or show reconnect prompt

**Command History:**
- Store in array, max 200 entries
- Up arrow: move backward through history, populate input
- Down arrow: move forward through history
- When at end of history, down arrow restores the empty/current input
- Save/restore from sessionStorage on page load/unload

### Styling

```
- Dark background (#1a1a2e or #0d1117), light text (#c9d1d9)
- Monospace font: "Cascadia Code", "Fira Code", "Source Code Pro", monospace
- Output area: full width, flex-grow to fill available height
- Input area: fixed at bottom, full width with send button
- Responsive: works on mobile (min-width: 320px)
- No scrollbar on body, only on output area
- Subtle border/shadow on output area for depth
```

### Keyboard Shortcuts

```
Enter        - Send command
Up Arrow     - Previous command in history
Down Arrow   - Next command in history
Ctrl+L       - Clear output display
Escape       - Clear input field
Page Up/Down - Scroll output
```

### Edge Cases to Handle

1. **Rapid messages**: The server may send many messages quickly. Batch DOM
   updates using requestAnimationFrame or a short debounce to avoid layout
   thrashing.

2. **Very long lines**: Some game output may have very long lines (ASCII art,
   maps). Use `white-space: pre-wrap` and `overflow-wrap: break-word`.

3. **Partial ANSI sequences**: A message from the server may end mid-escape
   sequence (e.g., `\x1b[3` with the `1m` arriving in the next message).
   Buffer incomplete sequences across messages.

4. **Connection lost without close**: If the network drops without a clean
   close frame, the browser fires `onclose` with code 1006. Display
   "Connection lost" rather than "Disconnected".

5. **Multiple rapid connects**: Disable the connect button while connecting
   to prevent duplicate connections.

6. **Large output history**: When pruning old lines, remove from the DOM in
   bulk (remove N oldest child nodes) rather than one at a time.

7. **Copy/paste from output**: Ensure styled spans don't interfere with
   text selection. Use `user-select: text` on the output area.

---

## Testing

### Manual Test Procedure

1. Start the LDMud driver with `enable_use_websockets=yes`
2. Open `webclient.html` in a browser
3. Enter the host and port, click Connect
4. Verify the WebSocket handshake succeeds (check browser dev tools Network tab)
5. Verify you see the login prompt / welcome message
6. Type a command and press Enter -- verify it works like a normal MUD client
7. Verify ANSI colors render correctly
8. Test command history with up/down arrows
9. Close the browser tab -- verify the driver handles disconnect cleanly
10. Test with WSS if TLS is configured

### Browser Compatibility

Target: Chrome 90+, Firefox 90+, Safari 15+, Edge 90+. All support
the WebSocket API natively.

---

## Summary of Key Points for Implementation

- Single self-contained HTML file, no build tools, no dependencies
- Uses browser-native `WebSocket` API
- Text frames only (send commands as strings, receive game output as strings)
- Must parse ANSI escape codes for color rendering
- Command history with arrow keys
- Dark terminal-style theme with monospace font
- Auto-scroll with scroll-lock when user reads history
- Status bar showing connection state
- Handle reconnection gracefully
- The driver port is the same port used for telnet -- no separate WebSocket port needed
