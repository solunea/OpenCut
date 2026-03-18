precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_focus;
uniform float u_zoom;
uniform float u_tiltX;
uniform float u_tiltY;
uniform float u_rotationX;
uniform float u_rotationY;
uniform float u_perspective;
uniform float u_strength;
uniform float u_keepFrameFixed;

varying vec2 v_texCoord;

void main() {
  float scale = max(1.0, 1.0 + (u_zoom - 1.0) * u_strength);
  float tiltX = u_tiltX * u_strength;
  float tiltY = u_tiltY * u_strength;
  float rotationX = radians(u_rotationX) * u_strength;
  float rotationY = radians(u_rotationY) * u_strength;
  float perspective = clamp(u_perspective, 0.0, 1.0) * u_strength;
  vec4 baseColor = texture2D(u_texture, v_texCoord);
  vec2 centered = v_texCoord - vec2(0.5, 0.5);
  float cosR = cos(rotationX);
  float sinR = sin(rotationX);
  vec2 rotated = vec2(
    cosR * centered.x + sinR * centered.y,
    -sinR * centered.x + cosR * centered.y
  );
  float horizontalCompression = 1.0 - min(abs(tiltX) * (0.08 + perspective * 0.18), 0.24);
  float verticalCompression = 1.0 - min(abs(tiltY) * (0.08 + perspective * 0.18), 0.24);
  float scaleX = max(0.0001, horizontalCompression);
  float scaleY = max(0.0001, verticalCompression);
  float depthX = max(0.42, 1.0 + rotated.x * tiltX * (0.85 + perspective * 1.35));
  float depthY = max(0.42, 1.0 + rotated.y * tiltY * (0.85 + perspective * 1.35));
  vec2 sampleOffset = vec2(
    rotated.x / (scaleX * depthY),
    rotated.y / (scaleY * depthX)
  );
  sampleOffset.x -= tiltY * rotated.y * (0.12 + perspective * 0.28) / depthY;
  sampleOffset.y += tiltX * rotated.x * (0.12 + perspective * 0.28) / depthX;
  sampleOffset.x += rotationY * rotated.x * (0.22 + perspective * 0.2);
  sampleOffset.y += rotationY * rotated.x * perspective * 0.08;
  vec2 tiltedCoord = vec2(0.5, 0.5) + sampleOffset;
  vec2 sampleCoord = u_focus + (tiltedCoord - u_focus) / scale;
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
