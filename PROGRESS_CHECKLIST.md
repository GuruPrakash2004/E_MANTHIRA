# e-Mandira Pranali – Completed so far (checklist)

- [x] **Ask the Data assistant:** a page where staff ask questions about the temple data and get a figure, chart and table. It needs no AI model and runs read-only.
- [x] **Five languages:** English, Tamil, Kannada, Malayalam and Telugu, including everyday spoken wording, typos and Latin-letter typing.
- [x] **About 75 question types:** sevas, donations, halls, vouchers, expenses and income by head and branch, who collected how much, festivals, and pending or cancelled documents. Each one is tested on the live DB.
- [x] **Date understanding:** last week, last N days, months, specific dates, ranges, quarters and "since April". With no period named, it uses the current financial year.
- [x] **Smart filters:** payment mode, "above / below" amounts, and a named seva, hall, sannidhi or person.
- [x] **Chat screen:** chat-style layout with ChatGPT-style loading effects, animated charts, and a header "Ask me" shortcut.
- [x] **Voice input:** a microphone button using the browser's built-in speech recognition (Chrome or Edge).
- [x] **Searchable history:** past questions are saved in the new `WebAiQueryHistory` table, with search, re-run and delete.
- [x] **Voucher account heads:** the old EXE's logic ported to the Receipt, Payment, Journal and Purchase vouchers (allowed ledger groups, active and approved checks, balance column, Dr/Cr per line).
- [x] **Voucher auto-tally:** typing 2000 on one side fills the other, and both Debit and Credit stay editable.
- [x] **Seva list by Sannidhi:** only the sevas mapped to the chosen Sannidhi are listed, as in the old EXE.
- [x] **Split payment:** one Seva or Donation bill can be paid in parts by different modes (new `WebSplitPayment` table). The header keeps the main mode, and the receipt voucher gets one debit line per part. Tested with a real save in the live DB, then removed.
- [x] **Split reference rule fix:** the Designer's "Reference No required for UPI" rule now works with a split bill and names the part that needs it.
- [x] **History boxes:** every history card has a search box and room for 15 bills.
- [x] **Preview and Print on every bill:** in the history cards, and as a Print column in the full List window.
- [x] **Docs updated:** `CLAUDE.md`, the memory notes and `LEGACY_PARITY.md` record the two new tables and these changes.

## Still open
- [ ] Purchase Voucher edit and cancel (the old EXE has them).
- [ ] Review of the Tamil, Kannada, Malayalam and Telugu wording by a native speaker.
- [ ] "Ask the Data" payment-mode figures count a split bill fully under its main mode.
- [ ] Two failing report tests that were already failing (party outstanding, profit margin).
- [ ] Commit the changes; everything is still uncommitted in the working copy.
