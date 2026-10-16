"""
Resolution Selector (Live)

Same inputs and maths as ComfyUI's core Resolution Selector (aspect ratio,
megapixels, multiple), plus a live readout on the node showing the exact
width x height that will be output, updated as you change any setting.
"""
import math
from enum import Enum
from typing_extensions import override
from comfy_api.latest import ComfyExtension, io

WEB_DIRECTORY = "./js"


class AspectRatio(str, Enum):
    SQUARE = "1:1 (Square)"
    PHOTO_V = "2:3 (Portrait Photo)"
    PHOTO_H = "3:2 (Photo)"
    STANDARD_V = "3:4 (Portrait Standard)"
    STANDARD_H = "4:3 (Standard)"
    WIDESCREEN_V = "9:16 (Portrait Widescreen)"
    WIDESCREEN_H = "16:9 (Widescreen)"
    ULTRAWIDE_H = "21:9 (Ultrawide)"


ASPECT_RATIOS: dict[AspectRatio, tuple[int, int]] = {
    AspectRatio.SQUARE: (1, 1),
    AspectRatio.PHOTO_V: (2, 3),
    AspectRatio.PHOTO_H: (3, 2),
    AspectRatio.STANDARD_V: (3, 4),
    AspectRatio.STANDARD_H: (4, 3),
    AspectRatio.WIDESCREEN_V: (9, 16),
    AspectRatio.WIDESCREEN_H: (16, 9),
    AspectRatio.ULTRAWIDE_H: (21, 9),
}


class ResolutionSelectorLive(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="ResolutionSelectorLive",
            display_name="Resolution Selector (Live)",
            category="utilities",
            description="Calculate width and height from aspect ratio and megapixel target, with a live readout of the resulting size.",
            inputs=[
                io.Combo.Input(
                    "aspect_ratio",
                    options=AspectRatio,
                    default=AspectRatio.SQUARE,
                    tooltip="The aspect ratio for the output dimensions.",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.1,
                    max=16.0,
                    step=0.01,
                    round=0.01,
                    tooltip="Target total megapixels. 1.00 MP = 1024 x 1024.",
                ),
                io.ResolutionPreview.Input(
                    "preview",
                    tooltip="Live preview of the calculated output resolution.",
                ),
                io.Int.Input(
                    "multiple",
                    default=8,
                    min=8,
                    max=128,
                    step=4,
                    tooltip="Width and height are rounded to the nearest multiple of this value.",
                ),
            ],
            outputs=[
                io.Int.Output("width"),
                io.Int.Output("height"),
            ],
        )

    @classmethod
    def execute(cls, aspect_ratio: str, megapixels: float, multiple: int, preview=None) -> io.NodeOutput:
        w_ratio, h_ratio = ASPECT_RATIOS[aspect_ratio]
        total_pixels = megapixels * 1024 * 1024
        scale = math.sqrt(total_pixels / (w_ratio * h_ratio))
        width = round(w_ratio * scale / multiple) * multiple
        height = round(h_ratio * scale / multiple) * multiple
        return io.NodeOutput(width, height)


class ResolutionLiveExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [ResolutionSelectorLive]


async def comfy_entrypoint() -> ResolutionLiveExtension:
    return ResolutionLiveExtension()
