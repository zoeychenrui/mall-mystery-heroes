import './App.css';
import './components/HostRoom';
import HostRoom from './components/HostRoom';
import { ChakraProvider } from '@chakra-ui/react';
import {PlayerAdd} from './components/PlayerAddition';

function App() {
  return (
    <ChakraProvider>
      <div className="homepage">
        <h1>Mall Mystery Heroes</h1>
        <HostRoom/>
        
      </div>
    </ChakraProvider>
  );
}

export default App;
