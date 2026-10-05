const koffi = require('koffi');
const zlib = require('node:zlib');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

const SetCursorPos = user32.func('int __stdcall SetCursorPos(int x, int y)');
const mouse_event = user32.func('void __stdcall mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, void *dwExtraInfo)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, void *dwExtraInfo)');
const VkKeyScanA = user32.func('int16 __stdcall VkKeyScanA(short ch)');

const GetDC = user32.func('void * __stdcall GetDC(void *hWnd)');
const ReleaseDC = user32.func('int __stdcall ReleaseDC(void *hWnd, void *hDC)');
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *hDC)');
const CreateCompatibleBitmap = gdi32.func('void * __stdcall CreateCompatibleBitmap(void *hDC, int cx, int cy)');
const SelectObject = gdi32.func('void * __stdcall SelectObject(void *hDC, void *hgdiobj)');
const BitBlt = gdi32.func('int __stdcall BitBlt(void *hdcDest, int xDest, int yDest, int w, int h, void *hdcSrc, int xSrc, int ySrc, uint32 rop)');
const DeleteObject = gdi32.func('int __stdcall DeleteObject(void *hObject)');
const DeleteDC = gdi32.func('int __stdcall DeleteDC(void *hdc)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');
const GetCursorPos = user32.func('int __stdcall GetCursorPos(_Out_ uint8 *lpPoint)');

// Virtual screen spans every display; the origin (x/y) is negative when a monitor
// sits left of or above the primary.
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;

function getVirtualScreen() {
  return {
    x: GetSystemMetrics(SM_XVIRTUALSCREEN),
    y: GetSystemMetrics(SM_YVIRTUALSCREEN),
    width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
    height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
  };
}


const BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER', {
  biSize: 'uint32',
  biWidth: 'int32',
  biHeight: 'int32',
  biPlanes: 'uint16',
  biBitCount: 'uint16',
  biCompression: 'uint32',
  biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32',
  biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32',
  biClrImportant: 'uint32'
});
const GetDIBits = gdi32.func('int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 cLines, _Out_ uint8 *lpvBits, _Inout_ BITMAPINFOHEADER *lpbmi, uint32 usage)');

const LEFTDOWN = 0x0002;
const LEFTUP = 0x0004;
const RIGHTDOWN = 0x0008;
const RIGHTUP = 0x0010;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;
const INPUT_KEYBOARD = 1;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x1000;
const WHEEL_DELTA = 120;

const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_SHIFT = 0x10;

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t',
});
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t',
});
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  u: koffi.union('INPUT_UNION', {
    mi: MOUSEINPUT,
    ki: KEYBDINPUT,
  }),
});
const SIZEOF_INPUT = koffi.sizeof(INPUT);
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');

// uiohook-napi uses scan-code-like values; keybd_event expects Windows VK codes.
const UIO_TO_VK_MAP = Object.freeze({
  1: 0x1b, 2: 0x31, 3: 0x32, 4: 0x33, 5: 0x34, 6: 0x35, 7: 0x36, 8: 0x37, 9: 0x38, 10: 0x39, 11: 0x30,
  14: 0x08, 15: 0x09, 16: 0x51, 17: 0x57, 18: 0x45, 19: 0x52, 20: 0x54, 21: 0x59, 22: 0x55, 23: 0x49, 24: 0x4f, 25: 0x50,
  28: 0x0d, 29: 0x11, 30: 0x41, 31: 0x53, 32: 0x44, 33: 0x46, 34: 0x47, 35: 0x48, 36: 0x4a, 37: 0x4b, 38: 0x4c,
  42: 0x10, 44: 0x5a, 45: 0x58, 46: 0x43, 47: 0x56, 48: 0x42, 49: 0x4e, 50: 0x4d, 56: 0x12, 57: 0x20,
  54: 0x10, 157: 0x11, 184: 0x12,
});

// uiohook arrow codes carry an 0xE0 prefix (57416 = 0xE048); passing them raw to
// keybd_event's uint8 truncates to letter VKs (Up types 'H'). Patch these 4 only.
const UIO_ARROW_TO_VK = Object.freeze({
  57416: 0x26, // ArrowUp → VK_UP
  57424: 0x28, // ArrowDown → VK_DOWN
  57419: 0x25, // ArrowLeft → VK_LEFT
  57421: 0x27, // ArrowRight → VK_RIGHT
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// CRC32 table for pure Node.js PNG encoding
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function calcCrc(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calcCrc(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(width, height, bgraBuffer) {
  const stride = width * 4;
  const rawData = Buffer.alloc(height * (1 + stride));
  let destOffset = 0;
  for (let y = 0; y < height; y++) {
    rawData[destOffset++] = 0; // Filter: None
    const srcRowStart = y * stride;
    for (let x = 0; x < width; x++) {
      const px = srcRowStart + x * 4;
      rawData[destOffset++] = bgraBuffer[px + 2]; // R
      rawData[destOffset++] = bgraBuffer[px + 1]; // G
      rawData[destOffset++] = bgraBuffer[px + 0]; // B
      rawData[destOffset++] = bgraBuffer[px + 3]; // A
    }
  }
  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// ponytail: virtual-screen capture (GetDC(NULL) + SM_XVIRTUALSCREEN) covers every
// display; it inherits the process DPI context, so everything stays in physical
// pixels. Upgrade path: explicit DPI-awareness call if coordinate drift ever shows.
function captureSnippet(x, y, width = 120, height = 40) {
  const screen = getVirtualScreen();
  const clickX = Math.round(x);
  const clickY = Math.round(y);

  // Shrink the request when it is bigger than the whole virtual screen; the returned
  // width/height tell the renderer the size actually captured.
  const captureW = Math.min(width, screen.width);
  const captureH = Math.min(height, screen.height);

  // Strict clamp on all four edges (origin can be negative) so BitBlt never reads
  // outside the virtual screen; the caller is told where the click actually landed
  // inside the rect instead of assuming dead center.
  const srcX = Math.min(
    Math.max(clickX - Math.floor(captureW / 2), screen.x),
    screen.x + screen.width - captureW
  );
  const srcY = Math.min(
    Math.max(clickY - Math.floor(captureH / 2), screen.y),
    screen.y + screen.height - captureH
  );

  const hdcScreen = GetDC(null);
  const hdcMem = CreateCompatibleDC(hdcScreen);
  const hbm = CreateCompatibleBitmap(hdcScreen, captureW, captureH);
  const oldBmp = SelectObject(hdcMem, hbm);

  BitBlt(hdcMem, 0, 0, captureW, captureH, hdcScreen, srcX, srcY, 0x00CC0020);

  const bmi = {
    biSize: 40,
    biWidth: captureW,
    biHeight: -captureH, // top-down
    biPlanes: 1,
    biBitCount: 32,
    biCompression: 0,
    biSizeImage: captureW * captureH * 4,
    biXPelsPerMeter: 0,
    biYPelsPerMeter: 0,
    biClrUsed: 0,
    biClrImportant: 0
  };

  const bgraBuffer = Buffer.alloc(captureW * captureH * 4);
  GetDIBits(hdcMem, hbm, 0, captureH, bgraBuffer, bmi, 0);

  SelectObject(hdcMem, oldBmp);
  DeleteObject(hbm);
  DeleteDC(hdcMem);
  ReleaseDC(null, hdcScreen);

  const pngBuffer = encodePng(captureW, captureH, bgraBuffer);
  return {
    pngBase64: pngBuffer.toString('base64'),
    width: captureW,
    height: captureH,
    origX: srcX,
    origY: srcY,
    xPercent: Math.min(1, Math.max(0, (clickX - srcX) / captureW)),
    yPercent: Math.min(1, Math.max(0, (clickY - srcY) / captureH)),
  };
}
function decodePngToGray(pngBuffer) {
  let offset = 8;
  const chunks = [];
  let width = 0, height = 0;
  while (offset < pngBuffer.length) {
    const len = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const data = pngBuffer.slice(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width * height > 4096 * 4096) throw new Error('PNG too large, possible malformed macro');
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const decompressed = zlib.inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let srcPos = 0, dstPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = decompressed[srcPos++];
    const lineStart = dstPos;
    if (filter === 0) {
      decompressed.copy(out, dstPos, srcPos, srcPos + stride);
      srcPos += stride;
      dstPos += stride;
    } else if (filter === 1) {
      for (let x = 0; x < stride; x++) {
        const left = (x >= bpp) ? out[lineStart + x - bpp] : 0;
        out[dstPos++] = (decompressed[srcPos++] + left) & 0xff;
      }
    } else if (filter === 2) {
      const prevLineStart = lineStart - stride;
      for (let x = 0; x < stride; x++) {
        const up = (y > 0) ? out[prevLineStart + x] : 0;
        out[dstPos++] = (decompressed[srcPos++] + up) & 0xff;
      }
    } else if (filter === 3) {
      const prevLineStart = lineStart - stride;
      for (let x = 0; x < stride; x++) {
        const left = (x >= bpp) ? out[lineStart + x - bpp] : 0;
        const up = (y > 0) ? out[prevLineStart + x] : 0;
        out[dstPos++] = (decompressed[srcPos++] + Math.floor((left + up) / 2)) & 0xff;
      }
    } else if (filter === 4) {
      const prevLineStart = lineStart - stride;
      for (let x = 0; x < stride; x++) {
        const a = (x >= bpp) ? out[lineStart + x - bpp] : 0;
        const b = (y > 0) ? out[prevLineStart + x] : 0;
        const c = (x >= bpp && y > 0) ? out[prevLineStart + x - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        let pr = c;
        if (pa <= pb && pa <= pc) pr = a;
        else if (pb <= pc) pr = b;
        out[dstPos++] = (decompressed[srcPos++] + pr) & 0xff;
      }
    }
  }

  const gray = new Uint8Array(width * height);
  let src = 0;
  for (let i = 0; i < gray.length; i++) {
    const r = out[src++], g = out[src++], b = out[src++];
    src++; // skip A
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
  }
  return { width, height, gray };
}

function captureScreenGrayscale() {
  const screen = getVirtualScreen();
  const width = screen.width;
  const height = screen.height;
  const hdcScreen = GetDC(null);
  const hdcMem = CreateCompatibleDC(hdcScreen);
  const hbm = CreateCompatibleBitmap(hdcScreen, width, height);
  const oldBmp = SelectObject(hdcMem, hbm);
  // Source origin can be negative: displays left of / above the primary.
  BitBlt(hdcMem, 0, 0, width, height, hdcScreen, screen.x, screen.y, 0x00CC0020);

  const bmi = {
    biSize: 40,
    biWidth: width,
    biHeight: -height,
    biPlanes: 1,
    biBitCount: 32,
    biCompression: 0,
    biSizeImage: width * height * 4,
    biXPelsPerMeter: 0,
    biYPelsPerMeter: 0,
    biClrUsed: 0,
    biClrImportant: 0
  };

  const bgraBuffer = Buffer.alloc(width * height * 4);
  GetDIBits(hdcMem, hbm, 0, height, bgraBuffer, bmi, 0);
  SelectObject(hdcMem, oldBmp);
  DeleteObject(hbm);
  DeleteDC(hdcMem);
  ReleaseDC(null, hdcScreen);

  const gray = new Uint8Array(width * height);
  let src = 0;
  for (let i = 0; i < gray.length; i++) {
    const b = bgraBuffer[src++], g = bgraBuffer[src++], r = bgraBuffer[src++];
    src++;
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
  }
  return { width, height, gray };
}

function matchTemplateGrayscale(screen, tpl, threshold = 0.85, searchRegion = null, origX = null, origY = null) {
  const sw = screen.width, sh = screen.height, sGray = screen.gray;
  const tw = tpl.width, th = tpl.height, tGray = tpl.gray;

  if (tw > sw || th > sh) {
    return { found: false, matchX: -1, matchY: -1, confidence: 0 };
  }

  let minY = 0, maxY = sh - th;
  let minX = 0, maxX = sw - tw;

  if (searchRegion) {
    if (typeof searchRegion.yPercent === 'number') minY = Math.max(0, Math.floor(sh * searchRegion.yPercent));
    if (typeof searchRegion.heightPercent === 'number') maxY = Math.min(sh - th, Math.floor(minY + sh * searchRegion.heightPercent));
    if (typeof searchRegion.xPercent === 'number') minX = Math.max(0, Math.floor(sw * searchRegion.xPercent));
    if (typeof searchRegion.widthPercent === 'number') maxX = Math.min(sw - tw, Math.floor(minX + sw * searchRegion.widthPercent));
  }

  const p = [];
  for (let sy = Math.max(2, Math.floor(th / 5)); sy < th; sy += Math.max(4, Math.floor(th / 4))) {
    for (let sx = Math.max(2, Math.floor(tw / 5)); sx < tw; sx += Math.max(4, Math.floor(tw / 4))) {
      p.push({ sx, sy, offset: sy * tw + sx });
    }
  }

  const maxSampleDiff = (1 - threshold) * p.length * 255;
  const totalPixels = tw * th;
  const maxTotalDiff = totalPixels * 255;
  const diffThreshold = (1 - threshold) * maxTotalDiff;

  const candidates = [];
  let minDiff = Infinity;
  let minDiffX = -1, minDiffY = -1;

  for (let y = minY; y <= maxY; y += 2) {
    const ySw = y * sw;
    for (let x = minX; x <= maxX; x += 2) {
      let sDiff = 0;
      for (let i = 0; i < p.length; i++) {
        sDiff += Math.abs(sGray[ySw + p[i].sy * sw + x + p[i].sx] - tGray[p[i].offset]);
      }
      if (sDiff > maxSampleDiff) continue;

      let fullDiff = 0;
      for (let ty = 0; ty < th; ty++) {
        const sRow = ySw + ty * sw + x;
        const tRow = ty * tw;
        for (let tx = 0; tx < tw; tx++) {
          fullDiff += Math.abs(sGray[sRow + tx] - tGray[tRow + tx]);
        }
        if (fullDiff > diffThreshold) break;
      }

      if (fullDiff < minDiff) {
        minDiff = fullDiff;
        minDiffX = x;
        minDiffY = y;
      }

      if (fullDiff <= diffThreshold) {
        candidates.push({ x, y, diff: fullDiff });
      }
    }
  }

  let bestX = -1, bestY = -1;

  if (candidates.length > 0) {
    if (origX !== null && origY !== null) {
      for (const cand of candidates) {
        cand.dist = Math.hypot(cand.x - origX, cand.y - origY);
      }
      candidates.sort((a, b) => a.dist - b.dist || a.diff - b.diff);
    } else {
      candidates.sort((a, b) => a.diff - b.diff);
    }
    const best = candidates[0];
    bestX = best.x;
    bestY = best.y;
    minDiff = best.diff;
  } else {
    bestX = minDiffX;
    bestY = minDiffY;
  }

  if (bestX !== -1 && minDiff > 0) {
    const startX = Math.max(minX, bestX - 2), endX = Math.min(maxX, bestX + 2);
    const startY = Math.max(minY, bestY - 2), endY = Math.min(maxY, bestY + 2);
    for (let y = startY; y <= endY; y++) {
      const ySw = y * sw;
      for (let x = startX; x <= endX; x++) {
        let fullDiff = 0;
        for (let ty = 0; ty < th; ty++) {
          const sRow = ySw + ty * sw + x;
          const tRow = ty * tw;
          for (let tx = 0; tx < tw; tx++) {
            fullDiff += Math.abs(sGray[sRow + tx] - tGray[tRow + tx]);
          }
          if (fullDiff > minDiff) break;
        }
        if (fullDiff < minDiff) {
          minDiff = fullDiff;
          bestX = x;
          bestY = y;
          if (minDiff === 0) break;
        }
      }
      if (minDiff === 0) break;
    }
  }

  const confidence = 1 - (minDiff / maxTotalDiff);
  const found = confidence >= threshold;
  return { found, matchX: bestX, matchY: bestY, confidence };
}

function findTemplateOnScreen(visualAnchor) {
  if (!visualAnchor || !visualAnchor.templateBase64) {
    return { found: false, matchX: -1, matchY: -1, confidence: 0 };
  }

  const threshold = Number(visualAnchor.confidenceThreshold) || 0.85;
  const tplPng = Buffer.from(visualAnchor.templateBase64, 'base64');
  const tpl = decodePngToGray(tplPng);
  const screen = captureScreenGrayscale();
  const origin = getVirtualScreen();

  const origX = typeof visualAnchor.origX === 'number' ? visualAnchor.origX - origin.x : null;
  const origY = typeof visualAnchor.origY === 'number' ? visualAnchor.origY - origin.y : null;

  const match = matchTemplateGrayscale(screen, tpl, threshold, visualAnchor.searchRegion, origX, origY);
  // Bitmap-local → absolute screen coords (origin can be negative); the renderer
  // builds the click point from these and SetCursorPos expects absolute coords.
  if (match.matchX >= 0) {
    match.matchX += origin.x;
    match.matchY += origin.y;
  }
  return match;
}

function checkWatchdogs(watchdogs) {
  if (!Array.isArray(watchdogs) || watchdogs.length === 0) {
    return { triggered: false };
  }

  const activeRules = watchdogs.filter((w) => w && w.enabled && w.visualAnchor?.templateBase64);
  if (activeRules.length === 0) {
    return { triggered: false };
  }

  // Single capture for all watchdogs
  const screen = captureScreenGrayscale();

  for (const rule of activeRules) {
    const threshold = Number(rule.visualAnchor.confidenceThreshold) || 0.85;
    const tplPng = Buffer.from(rule.visualAnchor.templateBase64, 'base64');
    const tpl = decodePngToGray(tplPng);

    const match = matchTemplateGrayscale(screen, tpl, threshold, rule.visualAnchor.searchRegion);
    if (match.found) {
      return {
        triggered: true,
        watchdogName: rule.name || 'Unknown Modal',
      };
    }
  }

  return { triggered: false };
}


function sendKey(virtualKey, isDown) {
  keybd_event(virtualKey, 0, isDown ? 0 : KEYEVENTF_KEYUP, null);
}

function parseVirtualKey(key) {
  const match = /^VK_(\d+)$/.exec(String(key || ''));
  if (match) {
    const uiohookKeycode = Number(match[1]);
    return UIO_ARROW_TO_VK[uiohookKeycode] ?? UIO_TO_VK_MAP[uiohookKeycode] ?? uiohookKeycode;
  }

  if (typeof key === 'string' && key.length === 1) {
    const scan = VkKeyScanA(key.charCodeAt(0));
    if (scan !== -1) {
      return scan & 0xff;
    }
    return key.toUpperCase().charCodeAt(0);
  }

  return null;
}

function sendModifiers(modifiers, isDown) {
  const keys = [];
  if (modifiers?.ctrl) keys.push(VK_CONTROL);
  if (modifiers?.alt) keys.push(VK_MENU);
  if (modifiers?.shift) keys.push(VK_SHIFT);

  const orderedKeys = isDown ? keys : [...keys].reverse();
  orderedKeys.forEach((key) => sendKey(key, isDown));
}

function sendUnicodeChar(codePoint) {
  const inputs = [
    {
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: 0,
          wScan: codePoint,
          dwFlags: KEYEVENTF_UNICODE,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    },
    {
      type: INPUT_KEYBOARD,
      u: {
        ki: {
          wVk: 0,
          wScan: codePoint,
          dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
          time: 0,
          dwExtraInfo: 0,
        },
      },
    },
  ];
  SendInput(2, inputs, SIZEOF_INPUT);
}

async function typeText(text) {
  const str = String(text);
  for (let i = 0; i < str.length; i++) {
    sendUnicodeChar(str.charCodeAt(i));
    await delay(8);
  }
}

function getCursorPos() {
  const point = Buffer.alloc(8);
  GetCursorPos(point);
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
}

// ponytail: linear glide (<=16 frames x 8ms) instead of an instant SetCursorPos
// teleport, so hover chains in web UIs fire on the way in. Upgrade path: easing
// curve if hover-intent timing ever needs one.
async function moveCursorTo(x, y) {
  const start = getCursorPos();
  const dx = x - start.x;
  const dy = y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 2) {
    SetCursorPos(x, y);
    return;
  }

  const steps = Math.min(16, Math.max(2, Math.ceil(distance / 100)));
  for (let i = 1; i <= steps; i += 1) {
    SetCursorPos(Math.round(start.x + (dx * i) / steps), Math.round(start.y + (dy * i) / steps));
    if (i < steps) await delay(8);
  }
}

function requireMouseCoords(step) {
  const { x, y } = step.fallbackCoords || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Step ${step.stepNumber ?? '?'} (${step.type}) has no valid coordinates; blind clicks are disabled.`);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

async function performStep(step) {
  try {
    // Human-recorded pre-step pause (renderer caps delayBefore at 10s).
    if (step.delayBefore) await delay(step.delayBefore);
    if (step.type === 'move') {
      const { x, y } = requireMouseCoords(step);
      await moveCursorTo(x, y);
    } else if (step.type === 'click' || step.type === 'double_click' || step.type === 'right_click') {
      const { x, y } = requireMouseCoords(step);
      await moveCursorTo(x, y);
      // Let hover-driven layout (web UIs shift on :hover) settle before clicking.
      await delay(40);

      const isRightClick = step.type === 'right_click';
      const down = isRightClick ? RIGHTDOWN : LEFTDOWN;
      const up = isRightClick ? RIGHTUP : LEFTUP;
      const clicks = step.type === 'double_click' ? 2 : 1;

      for (let index = 0; index < clicks; index += 1) {
        try {
          mouse_event(down, 0, 0, 0, null);
        } finally {
          // FFI throw after press-down must never leave the button held system-wide.
          mouse_event(up, 0, 0, 0, null);
        }
        // Release (finally above) always precedes the double-click wait.
        if (index + 1 < clicks) await delay(50);
      }
    } else if (step.type === 'scroll') {
      const { x, y } = requireMouseCoords(step);
      await moveCursorTo(x, y);
      await delay(40); // hover settle so the wheel lands on the intended pane
      const rotation = Math.round(step.wheelData?.rotation || 0);
      if (rotation !== 0) {
        // libuiohook emits whole notches with vertical sign INVERTED on Windows
        // (up = -1, verified in libuiohook input_helper.c); mouse_event wants
        // WHEEL_DELTA units (120/notch), positive = up/right. `>>> 0` passes
        // negative deltas through the uint32 dwData slot as two's complement.
        const horizontal = Boolean(step.wheelData?.horizontal);
        const delta = (horizontal ? rotation : -rotation) * WHEEL_DELTA;
        mouse_event(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, 0, 0, delta >>> 0, null);
      }
    } else if (step.type === 'type_text' && step.keyData?.text) {
      try {
        sendModifiers(step.keyData.modifiers, true);
        await typeText(step.keyData.text);
      } finally {
        // FFI failure mid-typing must never leave Ctrl/Alt/Shift held system-wide.
        sendModifiers(step.keyData.modifiers, false);
      }
    } else if (step.type === 'keypress') {
      const virtualKey = parseVirtualKey(step.keyData?.key);
      if (virtualKey === null) throw new Error(`Unsupported virtual key: ${step.keyData?.key || 'unknown'}`);

      try {
        sendModifiers(step.keyData?.modifiers, true);
        sendKey(virtualKey, true);
        sendKey(virtualKey, false);
      } finally {
        // Same guarantee for chords: release even if the sequence dies halfway.
        sendModifiers(step.keyData?.modifiers, false);
      }
    }

    // The renderer can also schedule this delay; keeping it here makes direct IPC calls safe.
    await delay(Math.max(0, Number(step.delayAfterMs) || 0));
  } catch (error) {
    throw new Error(`Native playback failed: ${error.message}`);
  }
}

module.exports = { performStep, captureSnippet, findTemplateOnScreen, checkWatchdogs, moveCursorTo, getCursorPos, getVirtualScreen };
