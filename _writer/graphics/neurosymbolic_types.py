"""Kautz's six neurosymbolic architectures (2022), redrawn in Manim.

Primary source: https://doi.org/10.1002/aaai.12036, pp. 118–121.
Author's later clarification of Type 6: Kautz, LPOP 2024, slides 12–15.
This is an original schematic, not a reproduction of the inaccessible Claude artifact.
"""
from manim import *

config.frame_width = 14.7
config.frame_height = 12.0

INK = "#17212D"
MUTED = "#596779"
BORDER = "#DCE2E9"
BLUE = "#DEEDF8"
BLUE_EDGE = "#629DC6"
GOLD = "#F9EDCE"
GOLD_EDGE = "#C4A453"
CARD = "#FCFCFB"


def text(s, size=22, color=INK, bold=False):
    return Text(s, font="Arial", font_size=size, color=color,
                weight="BOLD" if bold else "NORMAL", line_spacing=0.85)


def box(label, pos, width=1.5, height=0.63, neural=False, size=21):
    shape = RoundedRectangle(
        width=width, height=height, corner_radius=0.12,
        fill_color=BLUE if neural else GOLD, fill_opacity=1,
        stroke_color=BLUE_EDGE if neural else GOLD_EDGE, stroke_width=1.5,
    ).move_to(pos)
    words = text(label, size).move_to(shape)
    if words.width > width - 0.18:
        words.scale_to_fit_width(width - 0.18)
    return VGroup(shape, words)


def arrow(a, b, color=MUTED):
    return Arrow(a, b, buff=0, color=color, stroke_width=2.3,
                 tip_length=0.13, max_tip_length_to_length_ratio=0.22)


class NeurosymbolicTypes(Scene):
    def construct(self):
        self.camera.background_opacity = 0
        self.add(text("Six types of neurosymbolic interaction", 35, bold=True).move_to([0, 5.52, 0]))
        self.add(text("Kautz (2022)  ·  Different architectures, not a ranking", 21, MUTED).move_to([0, 5.03, 0]))
        self.add(box("Neural", [-1.02, 4.57, 0], 1.55, 0.42, neural=True, size=18))
        self.add(box("Symbolic", [0.96, 4.57, 0], 1.75, 0.42, size=18))

        positions = [(-3.53, 2.63), (3.53, 2.63),
                     (-3.53, -0.68), (3.53, -0.68),
                     (-3.53, -3.99), (3.53, -3.99)]
        titles = ["Symbols in, symbols out", "Symbolic calls neural",
                  "Neural + symbolic pipeline", "Learn from symbolic examples",
                  "Symbolic structure in a network", "Neural calls symbolic"]
        descriptions = [
            "A neural model maps symbolic input\nto symbolic output.",
            "A symbolic controller calls a neural\nmodel as a helper.",
            "Perception produces symbols for reasoning;\nfeedback can train perception.",
            "Rules supply training examples;\nthe trained network predicts answers.",
            "Rules become structures or operations\nwithin the neural network.",
            "A neural controller invokes a solver\nand uses its result to continue.",
        ]
        for i, ((x, y), title, desc) in enumerate(zip(positions, titles, descriptions), 1):
            card = RoundedRectangle(width=6.77, height=3.12, corner_radius=0.17,
                                    fill_color=CARD, fill_opacity=1,
                                    stroke_color=BORDER, stroke_width=1.3).move_to([x, y, 0])
            self.add(card)
            self.add(text(f"TYPE {i}", 18, MUTED, bold=True).move_to([x, y+1.25, 0]))
            title_obj=text(title, 25, bold=True).move_to([x, y+0.87, 0])
            if title_obj.width > 6.25: title_obj.scale_to_fit_width(6.25)
            self.add(title_obj)
            desc_obj=text(desc, 21, MUTED).move_to([x, y-1.06, 0])
            if desc_obj.width > 6.25: desc_obj.scale_to_fit_width(6.25)
            self.add(desc_obj)
            self.diagram(i, x, y-0.05)

    def diagram(self, kind, x, y):
        if kind == 1:
            nodes=[box("Symbols", [x-2.05,y,0]),
                   box("Neural", [x,y,0], neural=True),
                   box("Symbols", [x+2.05,y,0])]
            self.add(*nodes)
            for a,b in zip(nodes,nodes[1:]):
                self.add(arrow(a.get_right()+RIGHT*.10,b.get_left()+LEFT*.10))
        elif kind in (2,6):
            outer_neural=kind==6
            outline=RoundedRectangle(width=5.5,height=1.25,corner_radius=.14,
                fill_color=BLUE if outer_neural else GOLD,fill_opacity=1,
                stroke_color=BLUE_EDGE if outer_neural else GOLD_EDGE,stroke_width=1.6).move_to([x,y,0])
            controller=text("Neural\ncontroller" if outer_neural else "Symbolic\ncontroller",21).move_to([x-1.5,y,0])
            helper=box("Symbolic\nsolver" if outer_neural else "Neural\nmodel",[x+1.40,y,0],width=1.8,height=.9,neural=not outer_neural,size=21)
            self.add(outline,controller,helper,
                     arrow([x-.62,y+.18,0],[x+.40,y+.18,0]),
                     arrow([x+.40,y-.18,0],[x-.62,y-.18,0]))
        elif kind == 3:
            left=box("Neural\nperception",[x-1.72,y+.10,0],width=1.9,height=.9,neural=True)
            right=box("Symbolic\nreasoner",[x+1.72,y+.10,0],width=1.9,height=.9)
            self.add(left,right,arrow([x-.65,y+.22,0],[x+.65,y+.22,0]))
            self.add(text("symbols",16,MUTED).move_to([x,y+.46,0]))
            self.add(arrow([x+.65,y-.19,0],[x-.65,y-.19,0],BLUE_EDGE))
            self.add(text("feedback",16,MUTED).move_to([x,y-.42,0]))
        elif kind == 4:
            examples=box("Rule-based\nexamples",[x-1.82,y,0],width=2.0,height=.9,size=21)
            net=box("Trained\nnetwork",[x+1.82,y,0],width=2.0,height=.9,neural=True,size=21)
            self.add(examples,net,arrow([x-.7,y,0],[x+.7,y,0]))
            self.add(text("training",17,MUTED).move_to([x,y+.27,0]))
        elif kind == 5:
            rules=box("Rules",[x-2.0,y,0],width=1.35,height=.65)
            self.add(rules,arrow([x-1.2,y,0],[x-.55,y,0]))
            self.add(text("structure",16,MUTED).move_to([x-.87,y+.25,0]))
            layers=[[[x-.1,y+.35,0],[x-.1,y-.35,0]],
                    [[x+.9,y+.47,0],[x+.9,y,0],[x+.9,y-.47,0]],
                    [[x+1.9,y+.35,0],[x+1.9,y-.35,0]]]
            for left,right in zip(layers,layers[1:]):
                for a in left:
                    for b in right:self.add(Line(a,b,color=GOLD_EDGE,stroke_width=1.7))
            for layer in layers:
                for p in layer:self.add(Circle(radius=.13,fill_color=BLUE,fill_opacity=1,stroke_color=BLUE_EDGE,stroke_width=1.5).move_to(p))
