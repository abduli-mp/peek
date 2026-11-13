import "./App.css";
import FileUploader from "./components/FileUploader";
import Footer from "./components/Footer";

function App() {
  return (
    <div className="max-w-[70%] mx-auto h-[100dvh] flex items-center justify-center flex-col">
      <FileUploader />
      <Footer />
    </div>
  );
}

export default App;
