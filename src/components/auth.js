import { auth } from "../utils/firebase";
import {
  Button,
  Input,
  Box,
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
import FilledEnterButton from "./FilledEnterButton";

const Auth = (props) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show, setShow] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [passRules, setPassRules] = useState(true);
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
    if (password.length < 6 && password.length > 0) {
      setPassRules(false);
    }
    else {
      setPassRules(true);
    }
  }, [password]);

  return (
    <Box 
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >  
      {errorMessage && (
        <Alert 
          borderRadius = '2xl'
          status="error"
          bg = '#FF5252'
        >
          <AlertIcon 
            color = 'white'
          />
          {errorMessage}
        </Alert>
      )} 
      <Stack 
        mt = '10px'
        spacing={4}
      >
        <Input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          borderWidth= "3px"//until theme is fixed
        />
        <Box position="relative">
          <InputGroup size="md">
            <Input
              pr="4.5rem"
              type={show ? 'text' : 'password'}
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              borderWidth= "3px"//until theme is fixed
            />
            <InputRightElement width="4.5rem">
              <Button
                h="1.75rem"
                size="sm"
                onClick={handleClick}
                variant="ghost"
                color="brand.100"
                _hover={{ bg: 'brand.500', color: 'black' }} // Change background and text color on hover
              >
                {show ? 'Hide' : 'Show'}
              </Button>
            </InputRightElement>
          </InputGroup>
          {isLoginPage && (
            <Box position="absolute" top="50%" right="-3rem" transform="translateY(-50%)" width="50px" height="50px">
              <FilledEnterButton send={signIn} />
            </Box>
          )}
        </Box>
        {!passRules && !isLoginPage && (
          <Text color="red.500" size="sm" fontStyle='italic'>Password needs to be at least 6 characters long.</Text>
        )}
        {!isLoginPage && (
          <InputGroup size="md">
            <Input
              pr="4.5rem"
              type="password"
              placeholder="Confirm password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              borderWidth= "3px"//until theme is fixed
            />
          </InputGroup>
        )}
        {isLoginPage ? (
          <>
            <Button variant="link" onClick={goToForgetPassword} color = 'brand.500'>Forgot Password?</Button>
            <Link as={RouterLink} to="/signup" align="center">
              <Text as="i" fontSize={12} color="white">
                Don't have an account? Create an account
              </Text>
            </Link>
          </>
        ) : (
          <Box position="relative" 
                bottom='63px'
                left="100%" 
                width="50px" 
                height="50px"
                mb={-10}>
              <FilledEnterButton send={checkPass} />
            </Box>
        )}
        {!isLoginPage && (
          <Link as={RouterLink} to="/login" align="center" >
            <Text as="i" fontSize={12} >
              Already have an account? Log in
            </Text>
          </Link>
        )}
      </Stack>
    </Box>
  );
};

export default Auth;
