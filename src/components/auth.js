import { auth, googleProvider } from "../utils/firebase";
import { Button, Input } from '@chakra-ui/react';
import { createUserWithEmailAndPassword, signInWithPopup, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { useState } from 'react';


const Auth = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    console.log(auth?.currentUser?.email);

    const signIn = async () => {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            console.log("User successfully signed in")
        } catch(err) {
            console.error("Error signing in:", err);
        }
    };

    const signUp = async () => {
        try {
            await createUserWithEmailAndPassword(auth, email, password);
            console.log("Account successfully created")
        } catch(err) {
        
            console.error("Error signing up:", err);
  
        }
    };
    

    const signInWithGoogle = async () => {
        try {
            await signInWithPopup(auth);
        } catch(err) {
            console.error(err);
        }
    };

    const logout = async () => {
        try {
            await signOut(auth);
            console.log("User successfully logged out")
        } catch(err) {
            console.error(err);
        }
    };

    return (
   
        <div>
            <Input 
            placeholder="Email..."
            onChange={(e) => setEmail(e.target.value)}
            />
            <Input 
            placeholder="Password..."
            type="password"
            onChange={(e) => setPassword(e.target.value)}
            />
            <Button onClick={signIn}> Sign In</Button>
            <Button onClick={signUp}>Create Account</Button>
            {/* <Button onClick={signInWithGoogle}>Sign in with Google</Button> */}
            <Button onClick={logout}>Logout</Button>
        </div>
    );
};

export default Auth;