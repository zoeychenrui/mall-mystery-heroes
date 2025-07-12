import { Box, Heading, Image, Text } from "@chakra-ui/react";
import arrowRight from '../../assets/arrow-right.png'
import arrowLeft from '../../assets/arrow-left.png'
import GamePhotos from "./GamePhotos";
const PhotosDisplay = () => {
    return (
        <>
            <Box sx = {styles.photosContainer}>
                <Heading size = 'lg' m = '4px'>Photos</Heading>
                <Box sx = {styles.photosBox}>
                    <GamePhotos />
                </Box>
                <Box sx = {styles.buttonsBox}>
                    <Image 
                        src = {arrowLeft}
                        sx = {styles.buttonImage}
                    />
                    <Image 
                        src = {arrowRight}
                        sx = {styles.buttonImage}

                    />
                </Box>
            </Box>
        </>
    );
}

const styles = {
    photosContainer: {
        h: '100%',
        w: '100%',
        borderWidth: 2,
        borderRadius: '3xl',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start'
    },
    photosBox: {
        w: '94%',
        h: '75%',
        alignItems: 'center',
        textAlign: 'center',
        flexGrow: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        marginX: '2px',
        borderWidth: 1
    },
    buttonsBox: {
        display: 'flex',
        flexDirection: 'row',
        w: '100%',
        justifyContent: 'center',
        alignItems: 'center'
    },
    buttonImage: {
        w: '10%',
        m: '4px',
        marginX: '30px',
        transition: 'opacity 0.3s',
        '&:hover': {
            opacity: 0.7
        }
    }
};
export default PhotosDisplay;