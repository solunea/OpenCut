precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_focus;
uniform float u_zoom;
uniform float u_tilt;
uniform float u_rotation;
uniform float u_perspective;
uniform float u_strength;
uniform float u_keepFrameFixed;

varying vec2 v_texCoord;

void main() {
  float scale = max(1.0, 1.0 + (u_zoom - 1.0) * u_strength);
  float tilt = u_tilt * u_strength;
  float rotation = radians(u_rotation) * u_strength;
  float perspective = clamp(u_perspective, 0.0, 1.0) * u_strength;
  vec4 baseColor = texture2D(u_texture, v_texCoord);
  vec2 zoomCoord = u_focus + (v_texCoord - u_focus) / scale;
  vec2 centered = zoomCoord - vec2(0.5, 0.5);
  float cosR = cos(rotation);
  float sinR = sin(rotation);
  vec2 rotated = vec2(
    cosR * centered.x + sinR * centered.y,
    -sinR * centered.x + cosR * centered.y
  );
  float verticalCompression = 1.0 - min(abs(tilt) * (0.08 + perspective * 0.18), 0.24);
  float scaleY = max(0.0001, verticalCompression);
  float depth = max(0.42, 1.0 + rotated.y * tilt * (0.85 + perspective * 1.35));
  vec2 sampleOffset = vec2(
    rotated.x / depth,
    rotated.y / scaleY
  );
  sampleOffset.x -= tilt * rotated.y * (0.12 + perspective * 0.28) / depth;
  sampleOffset.y += tilt * rotated.x * perspective * 0.045;
  vec2 sampleCoord = vec2(0.5, 0.5) + sampleOffset;
  vec4 zoomedColor = texture2D(u_texture, sampleCoord);
  float keepFrameFixed = step(0.5, u_keepFrameFixed);
  float opaqueInterior = smoothstep(0.98, 0.999, baseColor.a);
  vec4 keepFrameFixedColor = mix(
    baseColor,
    vec4(zoomedColor.rgb, baseColor.a),
    opaqueInterior
  );
  gl_FragColor = mix(zoomedColor, keepFrameFixedColor, keepFrameFixed);
}
