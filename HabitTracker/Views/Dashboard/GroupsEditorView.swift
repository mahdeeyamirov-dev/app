import SwiftUI

/// Sheet for editing the server's config: groups, their metrics with weekly
/// targets, and when the bot sends reminders. The whole config is loaded,
/// edited locally and saved back in one request.
struct GroupsEditorView: View {
    /// Called after a successful save so the dashboard can reload groups.
    let onSaved: () -> Void

    @AppStorage("serverURL") private var serverURL = ""
    @AppStorage("apiToken") private var apiToken = ""
    @Environment(\.dismiss) private var dismiss

    @State private var draft: TrackerConfig?
    @State private var original: TrackerConfig?
    @State private var selection: GroupConfig.ID?
    @State private var loadError: String?
    @State private var saveError: String?
    @State private var isSaving = false
    @State private var groupPendingDeletion: GroupConfig?

    var body: some View {
        VStack(spacing: 0) {
            if let loadError {
                ContentUnavailableView(
                    "Не удалось загрузить",
                    systemImage: "wifi.exclamationmark",
                    description: Text(loadError)
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if draft != nil {
                HStack(spacing: 0) {
                    groupList
                        .frame(width: 200)
                    Divider()
                    groupDetail
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                Divider()
                scheduleSection
                    .padding(.horizontal)
                    .padding(.vertical, 10)
            } else {
                ProgressView("Загрузка…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            footer
                .padding()
        }
        .frame(minWidth: 820, idealWidth: 880, minHeight: 540, idealHeight: 600)
        .task { await load() }
        .confirmationDialog(
            "Удалить группу «\(groupPendingDeletion?.name ?? "")»?",
            isPresented: Binding(
                get: { groupPendingDeletion != nil },
                set: { if !$0 { groupPendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Удалить", role: .destructive) {
                if let group = groupPendingDeletion { deleteGroup(group) }
            }
        } message: {
            Text("Участники этой группы при следующем нажатии в боте выберут группу заново. Их отметки сохранятся.")
        }
    }

    // MARK: - Groups

    private var groupList: some View {
        VStack(spacing: 0) {
            List(selection: $selection) {
                Section("Группы") {
                    ForEach(draft?.groups ?? []) { group in
                        Text(group.name.isEmpty ? "Без названия" : group.name)
                            .foregroundStyle(group.name.isEmpty ? .secondary : .primary)
                            .tag(group.id)
                    }
                }
            }
            Divider()
            HStack(spacing: 4) {
                Button {
                    addGroup()
                } label: {
                    Image(systemName: "plus")
                }
                .help("Добавить группу")
                Button {
                    groupPendingDeletion = draft?.groups.first { $0.id == selection }
                } label: {
                    Image(systemName: "minus")
                }
                .disabled(selection == nil)
                .help("Удалить группу")
                Spacer()
            }
            .buttonStyle(.borderless)
            .padding(8)
        }
    }

    @ViewBuilder
    private var groupDetail: some View {
        if let index = draft?.groups.firstIndex(where: { $0.id == selection }) {
            GroupEditor(group: groupBinding(at: index))
        } else {
            ContentUnavailableView(
                "Выберите группу",
                systemImage: "person.3",
                description: Text("Или добавьте новую кнопкой «+» слева")
            )
        }
    }

    private func groupBinding(at index: Int) -> Binding<GroupConfig> {
        Binding(
            get: { draft?.groups[safe: index] ?? GroupConfig(name: "") },
            set: { newValue in
                guard draft?.groups.indices.contains(index) == true else { return }
                draft?.groups[index] = newValue
            }
        )
    }

    private func addGroup() {
        let group = GroupConfig(name: "Новая группа", metrics: [MetricConfig(name: "Новый пункт")])
        draft?.groups.append(group)
        selection = group.id
    }

    private func deleteGroup(_ group: GroupConfig) {
        draft?.groups.removeAll { $0.id == group.id }
        selection = draft?.groups.first?.id
        groupPendingDeletion = nil
    }

    // MARK: - Schedule

    private var scheduleSection: some View {
        HStack(spacing: 24) {
            TimeSetting(title: "Вечернее напоминание", time: configBinding(\.reminderTime), defaultTime: "21:00")
            TimeSetting(title: "Итоги недели по воскресеньям", time: configBinding(\.summaryTime), defaultTime: "21:30")
            Spacer()
        }
    }

    private func configBinding(_ keyPath: WritableKeyPath<TrackerConfig, String?>) -> Binding<String?> {
        Binding(
            get: { draft?[keyPath: keyPath] ?? nil },
            set: { draft?[keyPath: keyPath] = $0 }
        )
    }

    // MARK: - Saving

    /// Problems that would make the server reject the config, shown before sending.
    private var validationMessage: String? {
        guard let draft else { return nil }
        for group in draft.groups {
            let groupName = group.name.trimmingCharacters(in: .whitespaces)
            if groupName.isEmpty { return "У одной из групп нет названия" }
            if group.metrics.contains(where: { $0.name.trimmingCharacters(in: .whitespaces).isEmpty }) {
                return "В группе «\(groupName)» есть пункт без названия"
            }
            if group.metrics.contains(where: { $0.target < 0 }) {
                return "В группе «\(groupName)» цель меньше нуля"
            }
        }
        return nil
    }

    private var footer: some View {
        HStack {
            if let message = validationMessage ?? saveError {
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .font(.callout)
            } else {
                Text("Изменения сразу видны в боте и на дашборде")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Отмена") { dismiss() }
                .keyboardShortcut(.cancelAction)
            Button("Сохранить") { Task { await save() } }
                .keyboardShortcut(.defaultAction)
                .disabled(draft == nil || draft == original || validationMessage != nil || isSaving)
        }
    }

    private func load() async {
        do {
            let config = try await DashboardService.fetchConfig(serverURL: serverURL, apiToken: apiToken)
            draft = config
            original = config
            selection = config.groups.first?.id
        } catch {
            loadError = DashboardService.message(for: error)
        }
    }

    private func save() async {
        guard let draft else { return }
        isSaving = true
        saveError = nil
        do {
            _ = try await DashboardService.saveConfig(draft, serverURL: serverURL, apiToken: apiToken)
            onSaved()
            dismiss()
        } catch {
            saveError = DashboardService.message(for: error)
        }
        isSaving = false
    }
}

/// Name and metrics of one group. Metrics are reordered by dragging; the
/// order is the order of buttons in the bot.
private struct GroupEditor: View {
    @Binding var group: GroupConfig

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Название группы", text: $group.name)
                .textFieldStyle(.roundedBorder)
                .font(.title3)
                .frame(maxWidth: 320)

            HStack(spacing: 8) {
                Text("Пункт").frame(maxWidth: .infinity, alignment: .leading)
                Text("Ввод").frame(width: 150, alignment: .leading)
                Text("Цель в неделю").frame(width: 100, alignment: .leading)
                Text("Ед.").frame(width: 60, alignment: .leading)
                Spacer().frame(width: 24)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)

            List {
                ForEach($group.metrics) { $metric in
                    MetricRow(metric: $metric) {
                        group.metrics.removeAll { $0.id == metric.id }
                    }
                }
                .onMove { group.metrics.move(fromOffsets: $0, toOffset: $1) }
            }
            .listStyle(.inset(alternatesRowBackgrounds: true))

            HStack {
                Button {
                    group.metrics.append(MetricConfig(name: "Новый пункт"))
                } label: {
                    Label("Добавить пункт", systemImage: "plus")
                }
                Spacer()
                Text("«Число» — участник отправляет количество, «Отметка» — день отмечается одним нажатием. Порядок меняется перетаскиванием.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding()
    }
}

private struct MetricRow: View {
    @Binding var metric: MetricConfig
    let onDelete: () -> Void

    /// "Число · сумма", "Число · лучший" or "Отметка" as one menu, since the
    /// way of adding up only matters for numbers.
    private enum InputKind: Hashable {
        case sum, max, check
    }

    private var kind: Binding<InputKind> {
        Binding(
            get: {
                if metric.type == .check { return .check }
                return metric.aggregate == .max ? .max : .sum
            },
            set: { kind in
                switch kind {
                case .sum:
                    metric.type = .count
                    metric.aggregate = .sum
                case .max:
                    metric.type = .count
                    metric.aggregate = .max
                case .check:
                    metric.type = .check
                    metric.aggregate = .sum
                }
            }
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            TextField("Название", text: $metric.name)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: .infinity)

            Picker("Ввод", selection: kind) {
                Text("Число, сумма").tag(InputKind.sum)
                Text("Число, лучший").tag(InputKind.max)
                Text("Отметка").tag(InputKind.check)
            }
            .labelsHidden()
            .frame(width: 150)
            .help("Сумма — отметки за неделю складываются. Лучший — в зачёт идёт лучший результат недели (например, баллы теста).")

            TextField("Цель", value: $metric.target, format: .number)
                .textFieldStyle(.roundedBorder)
                .frame(width: 100)
                .help(metric.type == .check ? "Сколько дней в неделю" : "Сколько нужно набрать за неделю")

            TextField(metric.type == .check ? "дн." : "стр.", text: $metric.unit)
                .textFieldStyle(.roundedBorder)
                .frame(width: 60)
                .disabled(metric.type == .check)

            Button(role: .destructive, action: onDelete) {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .frame(width: 24)
            .help("Удалить пункт. Отметки участников сохранятся и вернутся, если добавить пункт снова.")
        }
        .padding(.vertical, 2)
    }
}

/// A toggle plus an hour:minute picker bound to an optional "HH:mm" string.
private struct TimeSetting: View {
    let title: String
    @Binding var time: String?
    let defaultTime: String

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private var date: Binding<Date> {
        Binding(
            get: { Self.formatter.date(from: time ?? defaultTime) ?? .now },
            set: { time = Self.formatter.string(from: $0) }
        )
    }

    var body: some View {
        HStack(spacing: 8) {
            Toggle(title, isOn: Binding(
                get: { time != nil },
                set: { time = $0 ? defaultTime : nil }
            ))
            DatePicker(title, selection: date, displayedComponents: .hourAndMinute)
                .labelsHidden()
                .datePickerStyle(.field)
                .disabled(time == nil)
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
