---
type: tikz
title: A TikZ node
caption: "A `type: tikz` node: the file's body is the picture."
libraries: [arrows.meta]
---
\begin{tikzpicture}[>={Stealth[length=3mm]}, node distance=3cm, every node/.style={draw, rounded corners, minimum width=2.4cm, minimum height=1cm}]
  \node (a) {welcome};
  \node (b) [right of=a] {idea};
  \node (c) [right of=b] {topics};
  \node (d) [below of=b] {roadmap};
  \draw[->] (a) -- (b);
  \draw[->] (b) -- (c);
  \draw[->, dashed] (a) |- (d);
\end{tikzpicture}
