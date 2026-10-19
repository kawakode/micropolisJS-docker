import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import { GitRevisionPlugin } from 'git-revision-webpack-plugin';
import HtmlWebpackPlugin  from 'html-webpack-plugin';
import path from 'path';
import webpack from 'webpack';

// Workaround now this is a module...
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// const StripAssertionCode = require('ts-transformer-unassert').default;

const ADD_TS_EXTENSIONS_TO_WEPACK = [".ts", ".tsx", ".js"];
const SUPPORT_FULLY_QUALIFIED_TS_ESM_IMPORTS = {
  ".js": [".js", ".ts"],
  ".cjs": [".cjs", ".cts"],
  ".mjs": [".mjs", ".mts"],
};
const HANDLE_TYPESCRIPT_WITH_TS_LOADER = { test: /\.([cm]?ts|tsx)$/, loader: "ts-loader" };

const OUTPUT_DIRECTORY = 'dist';

// The server's bundle: outside dist/, so that it is never served
const SERVER_OUTPUT_DIRECTORY = 'build/server';

// Where `npm run dev` sends the API and the game's WebSocket: the server started by `npm run start:server`
const DEV_API_SERVER = 'http://127.0.0.1:3000';

function recursivelyCopy(dir) {
  return {from: dir, to: dir, toType: 'dir'};
}

function cleanUpLeftovers() {
  return new CleanWebpackPlugin();
}

function copyStaticAssets() {
  return new CopyPlugin({
    "patterns": [
      recursivelyCopy('css'),
      recursivelyCopy('images'),
      recursivelyCopy('cities'),
      recursivelyCopy('sprites'),
      'LICENSE',
      'COPYING',
      'favicon.ico',
      'manifest.webmanifest',
      // Loaded without defer by index.html, so it is not part of the bundle
      {from: 'src/hasScript.js', to: 'src/hasScript.js'},
    ]
  });
}

function injectBundleIntoHTML(gitHash) {
  return new HtmlWebpackPlugin({
    gitHash,
    inject: true,
    hash: true,
    // The captcha worker is started by the game, never loaded as a page script
    chunks: ['micropolis'],
    template: './index.html',
    filename: 'index.html'
  });
}

function injectBuildIdIntoAbout(gitHash) {
  return new HtmlWebpackPlugin({
    gitHash,
    inject: false,
    hash: true,
    template: './about.html',
    filename: 'about.html'
  });
}

function injectBuildIdIntoNameLicense(gitHash) {
  return new HtmlWebpackPlugin({
    gitHash,
    inject: false,
    hash: true,
    template: './name_license.html',
    filename: 'name_license.html'
  });
}

function addDevelopmentConfigTo(options) {
  options.devServer = {
    static: `./${OUTPUT_DIRECTORY}`,
    port: 8080,
    // The dev server keeps /ws for its own reloads; the game's WebSocket is /api/ws
    proxy: [{context: ['/api'], target: DEV_API_SERVER, ws: true}],
  };

  options.devtool = 'source-map';
  options.mode = 'development';
}

function addProductionConfigTo(options) {
  /*
  const assertionStrippingConfig = {
    options: {
      getCustomTransformers: () => {
        return ({before: [StripAssertionCode]});
      }
    }
  };
  stripTSAssertionsRule = Object.assign(assertionStrippingConfig, HANDLE_TYPESCRIPT_WITH_ATL);
  options.module.rules.push(stripTSAssertionsRule);
  */
}

function getBuildId() {
  // Allow the build id to be supplied externally (e.g. when building without a git checkout)
  if (process.env.BUILD_ID)
    return process.env.BUILD_ID;

  try {
    // Technically don't need to use the webpack plugin, as not passing it to Webpack...
    const gitPlugin = new GitRevisionPlugin({
      commitHashCommand: `log -1 --pretty=format:%h HEAD`
    });

    return gitPlugin.commithash().slice(0, 12);
  } catch (e) {
    return 'unknown';
  }
}

function commonOptions(env, buildId) {
  const options = {
    name: 'client',
    entry: {
      micropolis: './src/micropolis.js',
      captchaWorker: './src/captchaWorker.js',
    },
    resolve: {
      extensions: ADD_TS_EXTENSIONS_TO_WEPACK,
      extensionAlias: SUPPORT_FULLY_QUALIFIED_TS_ESM_IMPORTS,
    },
    module: {
      rules: [
        HANDLE_TYPESCRIPT_WITH_TS_LOADER,
      ],
    },
    output: {
      path: path.resolve(__dirname, OUTPUT_DIRECTORY),
      filename: 'src/[name].js'
    },
    plugins: [
      // Not for the dev server, which builds in memory: dist/ stays as built, for the server (npm run start:server)
      ...(env.WEBPACK_SERVE ? [] : [cleanUpLeftovers()]),
      copyStaticAssets(),
      injectBundleIntoHTML(buildId),
      injectBuildIdIntoAbout(buildId),
      injectBuildIdIntoNameLicense(buildId),
    ],
  };

  return options;
}

function clientConfig(env, argv, buildId) {
  let options = commonOptions(env, buildId);

  if (env.development || argv.mode === 'development') {
    addDevelopmentConfigTo(options);
  } else {
    addProductionConfigTo(options);
  }

  return options;
}

// The server (server/main.ts) reuses the game's modules from src/, so it is bundled too. Its type checking is done by
// `npm run lint`.
function serverConfig(env, argv, buildId) {
  return {
    name: 'server',
    target: 'node22',
    entry: './server/main.ts',
    resolve: {
      extensions: ADD_TS_EXTENSIONS_TO_WEPACK,
      extensionAlias: SUPPORT_FULLY_QUALIFIED_TS_ESM_IMPORTS,
      // The game's windows use jQuery; the server only runs the simulation and the tools, never a window
      alias: {jquery: false},
    },
    module: {
      rules: [
        {
          ...HANDLE_TYPESCRIPT_WITH_TS_LOADER,
          options: {configFile: path.resolve(__dirname, 'server/tsconfig.json'), transpileOnly: true},
        },
      ],
    },
    // Installed in node_modules next to the bundle (the image's production dependencies)
    externals: {
      ws: 'commonjs ws',
      nodemailer: 'commonjs nodemailer',
    },
    output: {
      path: path.resolve(__dirname, SERVER_OUTPUT_DIRECTORY),
      filename: 'main.cjs',
      clean: true,
    },
    plugins: [
      // The server's default BUILD_ID: the same as the game's
      new webpack.DefinePlugin({__BUILD_ID__: JSON.stringify(buildId)}),
    ],
    devtool: 'source-map',
    // nodeEnv false: process.env.NODE_ENV stays a runtime value (the server never reads it anyway)
    optimization: {nodeEnv: false, minimize: false},
    performance: {hints: false},
  };
}

export default function(env, argv) {
  const buildId = getBuildId();

  return [clientConfig(env, argv, buildId), serverConfig(env, argv, buildId)];
};
