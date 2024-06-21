import { extendTheme } from "@chakra-ui/react";


const theme = extendTheme({
  components: {
    Input: {
      baseStyle: {
        field: {
          borderRadius: "20px",
          borderWidth: "20px", // Not working
          color : 'brand.100'
        },
      },
    },
  },
  styles: {
    global: {
      body: {
        color: "white",
        bg: "brand.300", // Background color for contrast
      },
    },
  },
  colors: {
    brand: {
      100: "#FFFFFF",
      200: "#86836D",
      300: "#202030",
      400: "#B20D30",
      500: "#9FF0AB",
    },
  },
  fonts: {
    heading: "Montserrat, sans-serif",
    body: "Montserrat, sans-serif",
  },
});

export default theme;
