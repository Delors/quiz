import { decryptAESGCMPBKDF } from "../shared/ld-crypto.js";

const convertModuleBasedSpecificationToLDQuizElement = async () => {
  const modules = document
    .querySelector("body > template")
    ?.content?.querySelectorAll("ld-module[name='ld-quiz']");

  if (!modules) return;

  modules.forEach((moduleElement) => {
    try {
      const encryptedQuiz = moduleElement.textContent.trim();
      if (!encryptedQuiz) {
        console.error("ld-quiz module is empty");
        return;
      }

      const quizElement = document.createElement("ld-quiz");
      quizElement.setAttribute("encrypted", "");
      quizElement.setAttribute("quiz", encryptedQuiz);

      // Optional: read server-url from module attributes
      const serverUrl = moduleElement.dataset.ldQuizServer;
      if (serverUrl) {
        quizElement.setAttribute("server-url", serverUrl);
      }

      moduleElement.replaceChildren(quizElement);
      console.log("ld-quiz element created");
    } catch (error) {
      console.error(
        `processing ld-quiz failed: ${error} (${moduleElement.textContent})`,
      );
    }
  });
};

// Check if we're in a LectureDoc2 environment
if (typeof ldEvents !== "undefined") {
  ldEvents.addEventListener(
    "beforeLDDOMManipulations",
    convertModuleBasedSpecificationToLDQuizElement,
  );
} else {
  // Fallback: process immediately if not in LectureDoc2
  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      convertModuleBasedSpecificationToLDQuizElement,
    );
  } else {
    convertModuleBasedSpecificationToLDQuizElement();
  }
}
