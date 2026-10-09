package domain

import (
	"testing"
	"time"
)

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 12, 0, 0, 0, time.UTC)
}

func TestAge(t *testing.T) {
	now := date(2026, time.June, 15)

	cases := []struct {
		name string
		birth time.Time
		want int
	}{
		{"birthday already passed this year", date(2000, time.March, 1), 26},
		{"birthday today", date(2000, time.June, 15), 26},
		{"birthday still ahead", date(2000, time.June, 16), 25},
		{"day before birthday", date(2008, time.June, 16), 17},
		{"turned eighteen today", date(2008, time.June, 15), 18},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Age(tc.birth, now); got != tc.want {
				t.Errorf("Age(%s) = %d, want %d", tc.birth.Format("2006-01-02"), got, tc.want)
			}
		})
	}
}

func TestProtectionProfile(t *testing.T) {
	now := date(2026, time.June, 15)

	cases := []struct {
		name      string
		birth     time.Time
		authority Authority
		want      Role
	}{
		{"child is supervised", date(2012, time.January, 1), AuthorityMember, RoleTeen},
		{"day before eighteenth birthday is still supervised", date(2008, time.June, 16), AuthorityMember, RoleTeen},
		{"adult member is unsupervised", date(1990, time.January, 1), AuthorityMember, RoleStandard},
		{"sixty-five is supervised", date(1961, time.June, 15), AuthorityMember, RoleSenior},
		{"sixty-four is not", date(1961, time.June, 16), AuthorityMember, RoleStandard},
		// Even a guardian is protected once they are old enough: supervision
		// follows age, not rank. Another family member approves them.
		{"elderly guardian is supervised", date(1955, time.June, 15), AuthorityGuardian, RoleSenior},
		// The owner is the last approver in the family: nobody is left to
		// approve the owner, so the owner is never under supervision.
		{"owner is never supervised regardless of age", date(1940, time.January, 1), AuthorityOwner, RoleStandard},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ProtectionProfile(tc.birth, tc.authority, now); got != tc.want {
				t.Errorf("ProtectionProfile(%s, %s) = %s, want %s",
					tc.birth.Format("2006-01-02"), tc.authority, got, tc.want)
			}
		})
	}
}

func TestRequiresSupervision(t *testing.T) {
	cases := map[Role]bool{
		RoleTeen:     true,
		RoleSenior:   true,
		RoleStandard: false,
	}

	for role, want := range cases {
		if got := role.RequiresSupervision(); got != want {
			t.Errorf("%s.RequiresSupervision() = %v, want %v", role, got, want)
		}
	}
}

func TestCanSupervise(t *testing.T) {
	cases := map[Authority]bool{
		AuthorityOwner:    true,
		AuthorityGuardian: true,
		AuthorityMember:   false,
	}

	for authority, want := range cases {
		if got := authority.CanSupervise(); got != want {
			t.Errorf("%s.CanSupervise() = %v, want %v", authority, got, want)
		}
	}
}
