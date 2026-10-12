// mapbox-gl ships dist/mapbox-gl.js already minified by Mapbox. Re-running
// Terser over it a second time during our own production build corrupted
// its vector-tile worker code: Safari threw "ReferenceError: Can't find
// variable: n" inside mapbox-gl's own web_worker_transfer.ts whenever a
// vector-tile style (e.g. the streets/"Standard" map style) tried to load a
// tile, while raster-only styles (satellite) were unaffected, since they
// never exercise that worker code path. CRA/react-scripts offers no way to
// adjust Terser's config without this override.
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    webpack: {
        configure: (webpackConfig) => {
            webpackConfig.optimization.splitChunks = {
                ...webpackConfig.optimization.splitChunks,
                cacheGroups: {
                    ...webpackConfig.optimization.splitChunks?.cacheGroups,
                    // A stable chunk name (unlike the default numeric chunk
                    // id) so the TerserPlugin exclude pattern below keeps
                    // matching it across builds despite the content hash.
                    mapboxgl: {
                        test: /[\\/]node_modules[\\/]mapbox-gl[\\/]/,
                        name: 'mapboxgl',
                        chunks: 'all',
                        enforce: true,
                    },
                },
            };

            const terser = webpackConfig.optimization.minimizer.find(
                (plugin) => plugin instanceof TerserPlugin
            );
            if (!terser) {
                throw new Error(
                    'craco.config.js expected a TerserPlugin minimizer in the CRA webpack config, ' +
                        'but did not find one — react-scripts may have changed its build config.'
                );
            }
            terser.options.exclude = /mapboxgl/;

            return webpackConfig;
        },
    },
};
