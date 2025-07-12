import { useToast } from '@chakra-ui/react';
const CreateAlert = () => {
    const toast = useToast()

    const showToast = (status, title, description, duration) => {
        toast ({
            title: title,
            description: description,
            status: status,
            duration: duration,
            isClosable: true,
        })
    }
    return showToast;
}
 
export default CreateAlert;