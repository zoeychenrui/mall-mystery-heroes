import { Image, Text } from "@chakra-ui/react";

export default function GamePhotos({ photo }) {
    if (!photo) {
        return <Text>No photos have been uploaded!</Text>;
    }

    return (
        <Image
            src={photo.url}
            alt="Unjudged photo"
            maxH="100%"
            maxW="100%"
            objectFit="contain"
        />
    );
}