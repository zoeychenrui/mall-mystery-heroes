import React from 'react';

const HostRoom = () => {

  function selectSet() {
    console.log('Host Room');
  }

  return (
    <button onClick={selectSet}>Host Room</button>
  );
}

export default HostRoom;