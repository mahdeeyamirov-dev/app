import SwiftUI

struct AddHabitView: View {
    @EnvironmentObject private var store: HabitStore
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var colorName = "blue"

    private let colorOptions: [(name: String, color: Color)] = [
        ("blue", .blue), ("red", .red), ("orange", .orange),
        ("yellow", .yellow), ("green", .green),
        ("purple", .purple), ("pink", .pink)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Новая привычка")
                .font(.headline)

            TextField("Название", text: $name)
                .textFieldStyle(.roundedBorder)

            HStack {
                ForEach(colorOptions, id: \.name) { option in
                    Circle()
                        .fill(option.color)
                        .frame(width: 24, height: 24)
                        .overlay {
                            if colorName == option.name {
                                Circle().stroke(.primary, lineWidth: 2)
                            }
                        }
                        .onTapGesture { colorName = option.name }
                }
            }

            HStack {
                Spacer()
                Button("Отмена") { dismiss() }
                Button("Добавить") {
                    store.addHabit(name: name.trimmingCharacters(in: .whitespaces), colorName: colorName)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 320)
    }
}
