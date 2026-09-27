// GLSL shared by the gallery's walls and its floor (which reflects them):
// the rotunda's bays, the picture lights' scallops of warm light, the
// paintings, the doorways, the high moonlit windows and the exit sign.
// Everything is computed per pixel from the angle round the room and the
// height above the floor, so the room costs one cylinder and one disc.

/** The rotunda's radius and its number of bays. */
export const ROOM_RADIUS = 34;
export const BAYS = 16;
/** Bays that open onto the next room (the first carries the exit sign). */
export const DOOR_BAYS = [3, 11];
/** Where the sculptures stand, and how many. */
export const SCULPTURE_RING = 21;
export const SCULPTURES = 6;
/**
 * Angle (round the room, from +x toward +z) of the first sculpture. Both
 * seats open looking the same way across the room (Black's board is walked
 * round, the camera is not), so the ring is turned to flank the tower in
 * that opening view rather than stand behind it, where it would show
 * through the glass among the pieces.
 */
export const SCULPTURE_PHASE = (44 * Math.PI) / 180;

export const ROOM_GLSL = /* glsl */ `
  #define TAU 6.28318530718
  uniform float uR;
  uniform vec3 uWall;
  uniform vec3 uWash;
  uniform vec3 uMoon;
  uniform vec3 uExit;
  uniform sampler2D uArt;

  float rh(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = i.x + i.y * 57.0;
    return mix(mix(rh(n), rh(n + 1.0), f.x), mix(rh(n + 57.0), rh(n + 58.0), f.x), f.y);
  }
  float f2(vec2 p) { return 0.5 * n2(p) + 0.3 * n2(p * 2.1 + 7.0) + 0.2 * n2(p * 4.3 + 3.0); }

  const float BAYS = ${BAYS}.0;
  bool doorBay(float k) { return k == ${DOOR_BAYS[0]}.0 || k == ${DOOR_BAYS[1]}.0; }

  // The picture light's scallop of warm light, from a fitting high on the wall
  float scallop(float dx, float h, float k) {
    float below = 8.6 - h;
    if (below < 0.0) return 0.0;
    float spread = 0.9 + 0.42 * below;
    float u = dx / spread;
    float edge = below - 0.28 * dx * dx;
    float s = smoothstep(0.0, 1.5, edge) * exp(-u * u * 1.4) * exp(-below * 0.11);
    return s * (0.75 + 0.5 * rh(k + 3.0)) * (doorBay(k) ? 0.35 : 1.0);
  }

  // A clerestory window high in each bay: 1 on its moonlit panes
  float windowGlass(float dx, float h) {
    float hw = 1.5;
    float y0 = 11.2;
    float y1 = 14.0;
    float rect = step(abs(dx), hw) * step(y0, h) * step(h, y1);
    float arch = step(length(vec2(dx, h - y1)), hw) * step(y1, h);
    float mx = abs(fract(dx / 0.75 + 0.5) - 0.5) * 0.75;
    float my = abs(fract((h - y0) / 1.05) - 0.5) * 1.05;
    float bar = max(step(mx, 0.035), step(my, 0.035) * step(h, y1));
    return max(rect, arch) * (1.0 - bar * 0.85);
  }

  // What the wall shows at angle theta (radians, 0..TAU) and height h above
  // the floor. detail 0 skips the paintings and the plaster (for reflections).
  vec3 wallRadiance(float theta, float h, float detail) {
    float s = theta / TAU * BAYS;
    float k = mod(floor(s), BAYS);
    float bayW = uR * TAU / BAYS;
    float dx = (fract(s) - 0.5) * bayW;
    float wash = scallop(dx, h, k);
    float plaster = detail > 0.5 ? 0.9 + 0.18 * f2(vec2(theta * uR * 0.45, h * 0.45)) : 1.0;
    // Light falls away up the wall
    float height = mix(1.0, 0.4, smoothstep(4.0, 19.0, h));
    vec3 col = uWall * plaster * height + uWash * wash * plaster;

    // Pilasters between the bays, catching a little of the light
    float edgeDist = bayW * 0.5 - abs(dx);
    float pilaster = smoothstep(0.75, 0.7, edgeDist);
    col *= 1.0 + 0.22 * pilaster * detail;
    col *= 1.0 - 0.3 * smoothstep(0.78, 0.74, edgeDist) * smoothstep(0.7, 0.74, edgeDist) * detail;

    // The skirting and the cornice
    col *= h < 0.35 ? 0.55 : 1.0;
    col += uWash * 0.05 * smoothstep(0.06, 0.0, abs(h - 0.36));
    col *= 1.0 - 0.4 * smoothstep(0.5, 0.0, abs(h - 17.3));

    // The windows: moonlit panes and a cool spill round them
    float win = windowGlass(dx, h);
    vec3 moonPane = uMoon * (0.5 + 0.3 * n2(vec2(dx * 1.7, h * 1.3)));
    col = mix(col, moonPane, win);
    col += uMoon * 0.05 * exp(-pow((h - 12.4) / 2.8, 2.0)) * exp(-dx * dx / 6.0) * (1.0 - win);

    if (doorBay(k)) {
      // A doorway onto the next room: the dim floor beyond, one far painting lit
      float dw = 2.5;
      float dh = 7.2;
      if (abs(dx) < dw && h < dh) {
        vec3 room = uWall * 0.18;
        room += uWash * 0.07 * exp(-pow(dx / 0.9, 2.0) - pow((h - 3.6) / 1.1, 2.0));
        room += uWash * 0.03 * smoothstep(1.8, 0.0, h);
        col = room;
      } else if (abs(dx) < dw + 0.4 && h < dh + 0.4) {
        col *= 1.35;
      }
      if (k == ${DOOR_BAYS[0]}.0) {
        // The exit sign, and its faint green halo on the wall
        vec2 q = vec2(dx, h - 8.3);
        if (abs(q.x) < 0.62 && abs(q.y) < 0.22) {
          float letters = step(0.08, abs(q.y)) + step(0.4, abs(fract(q.x * 3.2) - 0.5) * 2.0);
          col = uExit * mix(0.12, 0.45, clamp(letters, 0.0, 1.0));
        } else {
          col += uExit * 0.02 * exp(-dot(q, q) / 1.2);
        }
      }
    } else if (detail > 0.5) {
      // A painting in its frame, under its picture light
      float pw = 3.4 + 2.6 * rh(k * 1.7 + 1.0);
      float ph = 2.5 + 1.5 * rh(k * 2.3 + 5.0);
      if (rh(k * 3.1) > 0.62) pw = ph * 0.78;
      vec2 hs = vec2(pw, ph) * 0.5;
      vec2 q = vec2(dx, h - 4.4);
      vec2 dq = abs(q) - hs;
      float outside = max(dq.x, dq.y);
      float ft = 0.22;
      if (outside < 0.0) {
        vec2 uv = clamp((q + hs) / (2.0 * hs), 0.01, 0.99);
        float cell = mod(k * 3.0 + 1.0, 8.0);
        vec2 auv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + uv) / vec2(4.0, 2.0);
        vec3 art = texture2D(uArt, auv).rgb;
        col = art * (0.012 + 0.11 * wash);
      } else if (outside < ft) {
        vec3 frameCol = rh(k * 5.3) > 0.5 ? vec3(0.09, 0.065, 0.03) : vec3(0.012);
        float bevel = (q.y > 0.0 ? 1.25 : 0.8) * (0.7 + 0.6 * smoothstep(ft, 0.0, outside));
        col = frameCol * (0.3 + 2.0 * wash) * bevel;
      }
      // The picture light: a thin brass bar above the frame
      vec2 lq = vec2(dx, h - (4.4 + hs.y + 0.55));
      if (abs(lq.x) < 0.7 && abs(lq.y) < 0.05) col = uWash * 0.6;
    }
    return col;
  }
`;
