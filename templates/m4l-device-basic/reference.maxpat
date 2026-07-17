{
    "patcher": {
        "fileversion": 1,
        "appversion": {
            "major": 9,
            "minor": 1,
            "revision": 4,
            "architecture": "x64",
            "modernui": 1
        },
        "classnamespace": "box",
        "rect": [ -1541.0, 454.0, 1459.0, 603.0 ],
        "openrect": [ 0.0, 0.0, 0.0, 169.0 ],
        "openrectmode": 0,
        "default_fontsize": 10.0,
        "default_fontname": "Arial Bold",
        "gridsize": [ 8.0, 8.0 ],
        "toolbars_unpinned_last_save": 4,
        "boxanimatetime": 500,
        "boxes": [
            {
                "box": {
                    "id": "obj-22",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 412.0, 198.0, 127.0, 20.0 ],
                    "text": "nonstandardoutletcalls 1"
                }
            },
            {
                "box": {
                    "disablefind": 0,
                    "id": "obj-17",
                    "maxclass": "jweb",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 137.0, 259.0, 461.0, 214.0 ],
                    "rendermode": 0,
                    "url": "file:///Users/Matthew/ableton-agent-toolkit/devices/test-device/ui/interface.html"
                }
            },
            {
                "box": {
                    "id": "obj-10",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 249.0, 500.0, 31.0, 20.0 ],
                    "text": "print"
                }
            },
            {
                "box": {
                    "id": "obj-33",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 625.0, 215.0, 444.0, 20.0 ],
                    "text": "read file:///Users/Matthew/ableton-agent-toolkit/devices/test-device/ui/interface.html"
                }
            },
            {
                "box": {
                    "id": "obj-24",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 754.0, 174.0, 53.0, 20.0 ],
                    "text": "loadbang"
                }
            },
            {
                "box": {
                    "comment": "",
                    "id": "obj-8",
                    "index": 0,
                    "maxclass": "outlet",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 194.0, 513.0, 30.0, 30.0 ]
                }
            },
            {
                "box": {
                    "comment": "",
                    "id": "obj-6",
                    "index": 0,
                    "maxclass": "inlet",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 236.0, 174.0, 44.0, 44.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-5",
                    "maxclass": "live.comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 42.0, 136.0, 58.0, 18.0 ],
                    "text": "MIDI to Live",
                    "textjustification": 0
                }
            },
            {
                "box": {
                    "id": "obj-4",
                    "maxclass": "live.comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 33.0, 16.0, 69.0, 18.0 ],
                    "text": "MIDI from Live",
                    "textjustification": 0
                }
            },
            {
                "box": {
                    "id": "obj-3",
                    "maxclass": "live.comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 63.0, 75.0, 122.0, 18.0 ],
                    "text": "Build your MIDI effect here",
                    "textjustification": 0
                }
            },
            {
                "box": {
                    "fontname": "Ableton Sans Medium Regular",
                    "fontsize": 11.0,
                    "hidden": 1,
                    "id": "obj-9",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ -5.0, 186.0, 133.0, 20.0 ],
                    "text": "Device vertical limit"
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-2",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 48.0, 114.0, 47.0, 20.0 ],
                    "text": "midiout"
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-1",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "int" ],
                    "patching_rect": [ 48.0, 34.0, 40.0, 20.0 ],
                    "text": "midiin"
                }
            }
        ],
        "lines": [
            {
                "patchline": {
                    "destination": [ "obj-2", 0 ],
                    "source": [ "obj-1", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10", 0 ],
                    "order": 0,
                    "source": [ "obj-17", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-8", 0 ],
                    "order": 1,
                    "source": [ "obj-17", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-17", 0 ],
                    "source": [ "obj-22", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22", 0 ],
                    "order": 1,
                    "source": [ "obj-24", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-33", 0 ],
                    "order": 0,
                    "source": [ "obj-24", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-17", 0 ],
                    "source": [ "obj-33", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-17", 0 ],
                    "source": [ "obj-6", 0 ]
                }
            }
        ],
        "latency": 0,
        "is_mpe": 0,
        "external_mpe_tuning_enabled": 0,
        "minimum_live_version": "",
        "minimum_max_version": "",
        "platform_compatibility": 0,
        "project": {
            "version": 1,
            "creationdate": 3590052786,
            "modificationdate": 3590052786,
            "viewrect": [ 0.0, 0.0, 300.0, 500.0 ],
            "autoorganize": 1,
            "hideprojectwindow": 1,
            "showdependencies": 1,
            "autolocalize": 0,
            "contents": {
                "patchers": {                }
            },
            "layout": {            },
            "searchpath": {            },
            "detailsvisible": 0,
            "amxdtype": 1835887981,
            "readonly": 0,
            "devpathtype": 0,
            "devpath": ".",
            "sortmode": 0,
            "viewmode": 0,
            "includepackages": 0
        },
        "autosave": 0,
        "saved_attribute_attributes": {
            "default_plcolor": {
                "expression": ""
            }
        },
        "oscreceiveudpport": 0
    }
}