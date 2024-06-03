import { auth } from "../utils/firebase";
import {
  Button,
  Input,
  Box,
  Flex,
  Stack,
  Link,
  Text,
  InputGroup,
  InputRightElement,
  Alert,
  AlertIcon,
} from '@chakra-ui/react';
import {
  createUserWithEmailAndPassword,
  signOut,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';

const Auth = (props) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show, setShow] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [passRules, setPassRules] = useState(false);
  const isLoginPage = props.isLoginPage;
  const navigate = useNavigate();

  const handleClick = () => setShow(!show);

  const signIn = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard');
      console.log("User successfully signed in");
    } catch (err) {
      setErrorMessage("Error signing in. Check either username or password.");
      console.error("Error signing in:", err);
    }
  };

  const signUp = async () => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      console.log("Account successfully created");
      navigate('/dashboard');
    } catch (err) {
      console.error("Error signing up:", err);
      setErrorMessage("Error signing up. Please try again.");
    }
  };

  const goToForgetPassword = async () => {
    navigate('/login/password-reset');
  };

  const logout = async () => {
    try {
      await signOut(auth);
      console.log("User successfully logged out");
    } catch (err) {
      console.error(err);
    }
  };

  const checkPass = () => {
    if (password !== password2) {
      setErrorMessage("Passwords do not match");
    } else {
      setErrorMessage(""); // Clear any previous error message
      signUp();
    }
  };


  useEffect(() => {
    if (password.length >= 6) {
      setPassRules(false);
    }
    else if (password.length > 0) {
      setPassRules(true);
    }
    else {
      setPassRules(false);
    }

  }, [password]);

  return (
    <Flex width="100%" align="center" justify="center" p={4}>
      <Box
        p={8}
        bg="white"
        borderRadius="md"
        boxShadow="md"
        width="100%"
        maxWidth="400px"
      >
        <Stack spacing={4}>
          {errorMessage && (
            <Alert status="error">
              <AlertIcon />
              {errorMessage}
            </Alert>
          )}
          <Input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <InputGroup size="md">
            <Input
              pr="4.5rem"
              type={show ? 'text' : 'password'}
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <InputRightElement width="4.5rem">
              <Button h="1.75rem" size="sm" onClick={handleClick}>
                {show ? 'Hide' : 'Show'}
              </Button>
            </InputRightElement>
          </InputGroup>
          {passRules && (
            <Text color="red.500" size = "sm" fontStyle='italic'>Password needs to be at least 6 characters long.</Text>
          )}
          {!isLoginPage && (
            <InputGroup size="md">
              <Input
                pr="4.5rem"
                type={'password'}
                placeholder="Confirm password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
              />
            </InputGroup>
            
          )}
          {isLoginPage ? (
            <>
              <Button colorScheme="blue" onClick={signIn}>Continue</Button>
              <Button variant="link" onClick={goToForgetPassword}>Forgot Password?</Button>
              <Link as={RouterLink} to="/signup" align="center">
                <Text as="i" fontSize={12} colorScheme="teal">
                  Don't have an account? Create an account
                </Text>
              </Link>
            </>
          ) : (
            <Button colorScheme="green" onClick={checkPass}>Submit</Button>
            
          )}
          {!isLoginPage && (<Link as={RouterLink} to="/login" align="center">
                    <Text as="i" fontSize={12} colorScheme="teal">
                    Already have an account? Log in
                    </Text>
                </Link>)}
        </Stack>
        
      </Box>
    </Flex>
  );
};

export default Auth;
