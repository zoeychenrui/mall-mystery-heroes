import { ChakraProvider } from '@chakra-ui/react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './App.css';
import DashBoard from './pages/DashBoard';
import GameMasterView from './pages/GameMasterView';
import Homepage from './pages/Homepage';
import JoinGame from './pages/JoinGame';
import Lobby from './pages/Lobby';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import PasswordReset from './pages/PasswordReset';
import PlayerGame from './pages/PlayerGame';
import ReconnectPending from './pages/ReconnectPending';
import RequireAuth from './components/RequireAuth';
import SignUp from './pages/SignUp';
import theme from './theme'; // Import your custom theme

function App() {
    return (
        <ChakraProvider theme={theme}>
            <BrowserRouter>
                <Routes>
                    <Route path="/" element={<Homepage />} />
                    <Route path="/join" element={<JoinGame />} />
                    <Route
                        path="/dashboard"
                        element={
                            <RequireAuth>
                                <DashBoard />
                            </RequireAuth>
                        }
                    />
                    <Route path="/login" element={<Login />} />
                    <Route path="/login/password-reset" element={<PasswordReset />} />
                    <Route path="/signup" element={<SignUp />} />
                    <Route
                        path="/rooms/:roomID/lobby"
                        element={
                            <RequireAuth>
                                <Lobby />
                            </RequireAuth>
                        }
                    />
                    <Route
                        path="/rooms/:roomID/waiting"
                        element={
                            <RequireAuth>
                                <PlayerGame />
                            </RequireAuth>
                        }
                    />
                    <Route
                        path="/rooms/:roomID/reconnecting/:requestId"
                        element={
                            <RequireAuth>
                                <ReconnectPending />
                            </RequireAuth>
                        }
                    />
                    <Route
                        path="/rooms/:roomID/GameMasterView"
                        element={
                            <RequireAuth>
                                <GameMasterView />
                            </RequireAuth>
                        }
                    />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </BrowserRouter>
        </ChakraProvider>
    );
}

export default App;
