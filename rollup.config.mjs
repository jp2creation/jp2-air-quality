import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";

export default {
  input: "src/jp2-air-quality.js",
  output: {
    file: "dist/jp2-air-quality.js",
    format: "es",
    sourcemap: false,
  },
  plugins: [
    replace({
      preventAssignment: true,
      values: {
        __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || "dev"),
      },
    }),
    terser(),
  ],
};
