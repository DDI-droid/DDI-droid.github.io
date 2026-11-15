"""Two inputs feed one unboxed calligraphic F, which produces actions."""
from pathlib import Path

from manim import *

INK = "#15171B"
MUTED = "#737B86"
ARROW = "#8C96A2"
HERE = Path(__file__).parent


class FunctionForms(Scene):
    def construct(self):
        self.camera.background_opacity = 0

        def label(text, obj):
            return Text(text, font="Arial", font_size=19, color=MUTED).next_to(
                obj, DOWN, buff=0.22
            )

        # One contiguous blue rectangle, partitioned into four adjoining cells.
        array = SVGMobject(str(HERE / "array-block.svg")).set_width(3.0)
        array.move_to([-4.45, 1.18, 0])

        # Retain the document-stack SVG approved by the user.
        papers = SVGMobject(str(HERE / "data-papers.svg")).set_height(1.42)
        papers.move_to([-4.45, -1.25, 0])

        # The glyph itself is filled black: no card, cuboid, or surrounding block.
        function = Text("𝓕", font="Cambria Math", font_size=150, color=INK)
        function.set_height(2.85)
        function.stretch_to_fit_width(2.55)
        function.move_to([0.05, 0, 0])

        actions = Text("Actions", font="Arial", font_size=37, color=INK)
        actions.move_to([4.55, 0, 0])

        def arrow(start, end):
            return Arrow(
                start, end, buff=0, color=ARROW, stroke_width=3.2,
                tip_length=0.20, max_tip_length_to_length_ratio=0.18,
            )

        # Both inputs point to the same large F; there is only one output.
        array_arrow = arrow(
            array.get_right() + RIGHT * 0.22,
            [function.get_left()[0] - 0.24, 0.83, 0],
        )
        data_arrow = arrow(
            papers.get_right() + RIGHT * 0.22,
            [function.get_left()[0] - 0.24, -0.83, 0],
        )
        output_arrow = arrow(
            function.get_right() + RIGHT * 0.24,
            actions.get_left() + LEFT * 0.24,
        )

        self.add(
            array, label("Array", array),
            papers, label("Data", papers),
            array_arrow, data_arrow,
            function, output_arrow, actions,
        )
