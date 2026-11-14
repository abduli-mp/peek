import "./App.css";
import FileUploader from "./components/FileUploader";
import Footer from "./components/Footer";

function App() {
  return (
      <div className="max-w-[70%] mx-auto flex items-center justify-between flex-col py-5">
        <FileUploader />
        <Footer />
      </div>
  );
}

export default App;
