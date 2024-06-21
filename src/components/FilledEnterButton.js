import EnterIcon from '../assets/Untitled design-2.svg';

const FilledEnterButton = ({ send }) => {
  return (
    <img 
      src={EnterIcon} 
      alt="Submit Button" 
      onClick={send} 
      style={{ cursor: 'pointer', marginLeft: '0.5rem', width: '50px', height: '50px' }} // Adjusted size
    />
  );
};

export default FilledEnterButton;
