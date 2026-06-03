"""Unit tests for slicer_profile_resolve (@BBL strip/append)."""

from backend.app.utils.slicer_profile_resolve import (
    append_bbl_printer_tag,
    has_bbl_printer_tag,
    resolve_profile_for_printer,
    split_profile_candidates,
    strip_bbl_printer_tag,
)


class TestSplitProfileCandidates:
    def test_single(self):
        assert split_profile_candidates("Bambu PLA Basic @BBL") == ["Bambu PLA Basic @BBL"]

    def test_comma_separated(self):
        assert split_profile_candidates("Bambu PLA Basic @BBL, Generic PLA @BBL") == [
            "Bambu PLA Basic @BBL",
            "Generic PLA @BBL",
        ]

    def test_blank_and_none(self):
        assert split_profile_candidates("") == []
        assert split_profile_candidates(None) == []
        assert split_profile_candidates(" , ,") == []


class TestHasBblPrinterTag:
    def test_base_without_token(self):
        assert has_bbl_printer_tag("Bambu PLA Basic @BBL") is False

    def test_with_token(self):
        assert has_bbl_printer_tag("Bambu PLA Basic @BBL X1C") is True

    def test_no_marker(self):
        assert has_bbl_printer_tag("Bambu PLA Basic") is False

    def test_empty(self):
        assert has_bbl_printer_tag("") is False


class TestStripBblPrinterTag:
    def test_strip_token(self):
        assert strip_bbl_printer_tag("Bambu PLA Basic @BBL X1C") == "Bambu PLA Basic @BBL"

    def test_strip_token_with_nozzle(self):
        assert strip_bbl_printer_tag("0.20mm Standard @BBL X1C 0.6 nozzle") == "0.20mm Standard @BBL"

    def test_multiword_token(self):
        assert strip_bbl_printer_tag("Bambu PLA Basic @BBL A1 Mini") == "Bambu PLA Basic @BBL"

    def test_already_base(self):
        assert strip_bbl_printer_tag("Bambu PLA Basic @BBL") == "Bambu PLA Basic @BBL"

    def test_no_marker_unchanged(self):
        assert strip_bbl_printer_tag("Generic PLA") == "Generic PLA"


class TestAppendBblPrinterTag:
    def test_append_to_base_a1_mini(self):
        # Cloud process presets use the compact @BBL A1M suffix, not "A1 Mini".
        assert append_bbl_printer_tag("Bambu PLA Basic @BBL", "Bambu Lab A1 mini") == "Bambu PLA Basic @BBL A1M"

    def test_append_to_base_p1s(self):
        assert append_bbl_printer_tag("Bambu PLA Basic @BBL", "P1S") == "Bambu PLA Basic @BBL P1S"

    def test_append_from_printer_preset_name(self):
        # The SliceModal printer is a full preset name with a nozzle suffix.
        assert (
            append_bbl_printer_tag("0.20mm Standard @BBL", "Bambu Lab A1 mini 0.4 nozzle")
            == "0.20mm Standard @BBL A1M"
        )

    def test_plain_name_gets_marker_and_token(self):
        assert append_bbl_printer_tag("Bambu PLA Basic", "P1S") == "Bambu PLA Basic @BBL P1S"

    def test_already_qualified_unchanged(self):
        assert append_bbl_printer_tag("Bambu PLA Basic @BBL X1C", "P1S") == "Bambu PLA Basic @BBL X1C"

    def test_setting_id_unchanged(self):
        assert append_bbl_printer_tag("GFSL05", "P1S") == "GFSL05"
        assert append_bbl_printer_tag("PFUSabc123", "A1 Mini") == "PFUSabc123"

    def test_unknown_printer_returns_base(self):
        assert append_bbl_printer_tag("Bambu PLA Basic @BBL", None) == "Bambu PLA Basic @BBL"
        assert append_bbl_printer_tag("Bambu PLA Basic @BBL", "") == "Bambu PLA Basic @BBL"


class TestResolveProfileForPrinter:
    def test_resolves_each_candidate(self):
        assert resolve_profile_for_printer("Bambu PLA Basic @BBL, Generic PLA @BBL", "P1S") == [
            "Bambu PLA Basic @BBL P1S",
            "Generic PLA @BBL P1S",
        ]

    def test_mixed_candidates(self):
        # A comma list mixing a base name and a bare id keeps the id intact.
        assert resolve_profile_for_printer("Bambu PLA Basic @BBL, GFSL05", "A1 Mini") == [
            "Bambu PLA Basic @BBL A1M",
            "GFSL05",
        ]

    def test_empty(self):
        assert resolve_profile_for_printer("", "P1S") == []
