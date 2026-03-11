precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_focus;
uniform float u_zoom;
uniform float u_strength;
uniform float u_keepFrameFixed;

varying vec2 v_texCoord;

void main() {
  float scale = max(1.0, 1.0 + (u_zoom - 1.0) * u_strength);
  vec4 baseColor = texture2D(u_texture, v_texCoord);
  vec2 sampleCoord = u_focus + (v_texCoord - u_focus) / scale;
  vec4 zoomedColor = texture2D(u_texture, sampleCoord);
  float keepFrameFixed = step(0.5, u_keepFrameFixed);
  float preserveSilhouette = keepFrameFixed * (1.0 - step(0.999, baseColor.a));
  vec4 fixedFrameColor = vec4(zoomedColor.rgb, baseColor.a);
  vec4 keepFrameFixedColor = mix(fixedFrameColor, baseColor, preserveSilhouette);
  gl_FragColor = mix(zoomedColor, keepFrameFixedColor, keepFrameFixed);
}
