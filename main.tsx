import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StudioApp } from "./StudioApp";
import "./studio.css";

const container = document.getElementById("studio");
if (!container) throw new Error("The studio root element is missing.");

createRoot(container).render(<StrictMode><StudioApp /></StrictMode>);
