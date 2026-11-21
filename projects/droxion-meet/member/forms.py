from django import forms
from django.utils import timezone

from .models import Message, Plan, Profile, Report


class ProfileForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ["name", "bio", "interests", "intention", "community", "visible"]

    def clean_community(self):
        return " ".join(self.cleaned_data["community"].casefold().split())


class MessageForm(forms.ModelForm):
    class Meta:
        model = Message
        fields = ["body"]


class PlanForm(forms.ModelForm):
    class Meta:
        model = Plan
        fields = ["category", "when"]
        widgets = {"when": forms.DateTimeInput(attrs={"type": "datetime-local"})}
        labels = {"when": "Suggested date and time (UTC)"}

    def clean_when(self):
        when = self.cleaned_data["when"]
        if when <= timezone.now():
            raise forms.ValidationError("Choose a future date and time.")
        return when


class ReportForm(forms.ModelForm):
    message = forms.IntegerField(required=False, min_value=1, widget=forms.HiddenInput)

    class Meta:
        model = Report
        fields = ["category", "details"]
