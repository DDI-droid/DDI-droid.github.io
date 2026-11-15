# Sources for the six-type figure

## Scope

Original Manim schematic of Henry Kautz's **2022 six-type taxonomy**, not a reproduction of the Claude artifact supplied in the conversation (which returned “Page not found”). Types are architectural/training distinctions, not a capability ranking. “Neural” replaces “Neuro” in some plain-language labels; Type 3 uses the original paper's vertical bar.

## Primary sources checked

1. Henry Kautz, *The third AI summer: AAAI Robert S. Engelmore Memorial Lecture*, AI Magazine 43 (2022), 105–125. DOI: https://doi.org/10.1002/aaai.12036
   - Author-hosted PDF: https://henrykautz.com/papers/AI%20Magazine%20-%202022%20-%20Kautz%20-%20The%20third%20AI%20summer%20%20AAAI%20Robert%20S%20%20Engelmore%20Memorial%20Lecture.pdf
   - pp. 118–121 / PDF pages 14–17: six architectures and figures 10–15.
   - p. 119: Type 6's symbolic subsystem is a subroutine of the main neural system; the neural agent can choose an action that starts the solver.
   - p. 120: the solver need not be differentiable; its outputs can become subsequent neural inputs and/or training examples.
   - p. 121, figure 15: neural mouse agent invokes a shortest-path solver and then uses its result.

2. Henry Kautz, *Neuro-Symbolic AI, or, Are We Already There?*, LPOP / ICLP 2024.
   - Author index: https://henrykautz.com/talks/index.html
   - Slides: https://henrykautz.com/talks/Kautz%20Neuro%20Symbolic%20LPOP%202024.pptx
   - Slides 12–15 revisit Neuro[Symbolic()]. Slide 15 explicitly describes it as an instance of “LLM with tools.”
   - Later slides demonstrate GPT with SAT solving and theorem proving, including errors in translating implicit constraints. A correct solver does not guarantee a correct natural-language-to-formal translation.
   - This is a later presentation with a changed taxonomy, not the source of the six-type numbering in the figure.

3. Timo Schick et al., *Toolformer: Language Models Can Teach Themselves to Use Tools* (2023), https://arxiv.org/abs/2302.04761
   - Abstract checked for the accompanying discussion: model learns which APIs to call, when, with what arguments, and how to incorporate results. Its calculator use illustrates neural-led delegation; not every listed tool is a symbolic reasoner.
   - This is a supporting comparison, not a claim that the paper categorizes itself using Kautz's Type 6 label.

## Harness interpretation

- Type 2: deterministic symbolic search/planning calls a model.
- Type 3: neural output becomes structured input for symbolic processing.
- Type 6: neural decisions trigger a solver/tool, with results returned to the model; external execution by a harness does not rule this out.
- Type 4 needs a training procedure using symbolically derived examples; runtime calls alone are insufficient.
- Type 5 needs symbolic structure/operations in the network; a generic API wrapper alone is insufficient.
- Nested software can exhibit different types at different subsystem boundaries. Merely observing that a model ultimately runs inside a program is not enough to classify every agent as Type 2.
