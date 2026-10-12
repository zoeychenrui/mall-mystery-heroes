// mapbox-gl creates its tile-parsing Web Worker by extracting specific
// functions out of its own bundled module and running their `.toString()`
// text inside a Blob-URL worker — those functions must be fully
// self-contained, since a worker has no access to the main thread's module
// registry or closures.
//
// CRA's webpack config runs EVERY .js/.mjs file under node_modules through
// Babel (react-scripts/config/webpack.config.js, the "Process any JS
// outside of the app with Babel" rule), using babel-preset-react-app's
// dependencies preset with externalized runtime helpers. mapbox-gl ships
// dist/mapbox-gl.js already built, including 74 native object-spread
// (`{...x}`) expressions it never needed to down-level for its own targets
// — CRA's Babel pass "fixes" those anyway, injecting
// `require('@babel/runtime/helpers/objectSpread2')`-style calls directly
// into mapbox-gl's own compiled module. Any mapbox-gl function that uses
// that helper AND gets `.toString()`-extracted into the worker Blob now
// references a variable with no binding in the worker's isolated scope —
// "ReferenceError: Can't find variable: _objectSpread" (or its minified
// name) the moment that code runs, only for vector-tile styles (e.g.
// streets/"Standard"), since raster styles like satellite never touch that
// code path.
//
// The fix is to stop re-processing mapbox-gl's already-built file at all:
// exclude it from that one babel-loader rule. CRA/react-scripts offers no
// way to do this without an override like this one.
module.exports = {
    webpack: {
        configure: (webpackConfig) => {
            const oneOfRule = webpackConfig.module.rules.find((rule) => Array.isArray(rule.oneOf));
            if (!oneOfRule) {
                throw new Error(
                    'craco.config.js expected a "oneOf" rule in the CRA webpack config, ' +
                        'but did not find one — react-scripts may have changed its build config.'
                );
            }
            const dependenciesBabelRule = oneOfRule.oneOf.find(
                (rule) =>
                    rule.loader &&
                    rule.loader.includes('babel-loader') &&
                    rule.options &&
                    rule.options.presets &&
                    rule.options.presets.some(
                        (preset) =>
                            Array.isArray(preset) &&
                            preset[0].includes('babel-preset-react-app/dependencies')
                    )
            );
            if (!dependenciesBabelRule) {
                throw new Error(
                    'craco.config.js expected to find CRA\'s "process any JS outside of the ' +
                        'app with Babel" rule (babel-preset-react-app/dependencies), but did not ' +
                        'find one — react-scripts may have changed its build config.'
                );
            }
            const existingExclude = dependenciesBabelRule.exclude;
            dependenciesBabelRule.exclude = (path) =>
                /[\\/]node_modules[\\/]mapbox-gl[\\/]/.test(path) ||
                (typeof existingExclude === 'function'
                    ? existingExclude(path)
                    : existingExclude.test(path));

            return webpackConfig;
        },
    },
};
