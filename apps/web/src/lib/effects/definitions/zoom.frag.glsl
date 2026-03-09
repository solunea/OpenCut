precision mediump float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_focus;
uniform float u_zoom;
uniform float u_strength;

varying vec2 v_texCoord;

void main() {
  float scale = max(1.0, 1.0 + (u_zoom - 1.0) * u_strength);
  vec2 sampleCoord = u_focus + (v_texCoord - u_focus) / scale;
  gl_FragColor = texture2D(u_texture, sampleCoord);
}
