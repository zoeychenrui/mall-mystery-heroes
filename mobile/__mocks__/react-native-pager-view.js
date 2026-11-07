// Manual mock for the whole package, picked up by Jest automatically for
// every test in this project — there is no native PagerView under Jest.
// Unlike react-native-maps.js's mock (which renders every child always,
// since nothing there depends on which one is "current"), this one only
// renders the currently selected page: GameScreen's whole redesign is
// built around "only the active page's content is on screen," and a test
// asserting that needs the mock to actually hide the others, not just
// render everything inert underneath.
const React = require('react');
const { View } = require('react-native');

const PagerView = React.forwardRef(
    ({ children, onPageSelected, initialPage = 0, testID, style }, ref) => {
        const [page, setPage] = React.useState(initialPage);

        const goTo = React.useCallback(
            (index) => {
                setPage(index);
                onPageSelected?.({ nativeEvent: { position: index } });
            },
            [onPageSelected]
        );

        React.useImperativeHandle(ref, () => ({
            setPage: goTo,
            setPageWithoutAnimation: goTo,
        }));

        const pages = React.Children.toArray(children);
        return React.createElement(View, { testID, style }, pages[page] ?? null);
    }
);

module.exports = {
    __esModule: true,
    default: PagerView,
};
